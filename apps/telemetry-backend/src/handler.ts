import { type } from 'arktype';
import type { TelemetryDb } from './db';
import type { RateLimiter } from './rate-limiter';
import { eventPayloadSchema } from './schema';

export interface HandlerDeps {
  readonly db: TelemetryDb;
  readonly rateLimiter?: RateLimiter;
  /**
   * When true, the handler trusts the first `x-forwarded-for` address for
   * the per-IP rate-limit key. Enable only when the backend sits behind a
   * proxy that strips inbound `x-forwarded-for` and writes its own (e.g.
   * Prisma Compute). Defaults to false because any direct caller can set
   * the header otherwise and trivially bypass the limit.
   */
  readonly trustForwardedFor?: boolean;
}

export interface HandlerInfo {
  readonly remoteAddress?: string;
}

const EVENTS_PATH = '/events';
const PAYLOAD_TOO_LARGE = 'Payload Too Large';
const MALFORMED_JSON = 'Bad Request: malformed JSON';

export const MAX_EVENT_BODY_BYTES = 32 * 1024;
const MAX_EVENT_BODY_BYTES_BIGINT = BigInt(MAX_EVENT_BODY_BYTES);

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

class PayloadTooLargeError extends Error {
  constructor() {
    super(PAYLOAD_TOO_LARGE);
    this.name = 'PayloadTooLargeError';
  }
}

function contentLengthExceedsCap(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }
  return BigInt(trimmed) > MAX_EVENT_BODY_BYTES_BIGINT;
}

function declaredPayloadTooLarge(request: Request): boolean {
  return contentLengthExceedsCap(request.headers.get('content-length'));
}

function firstForwardedAddress(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.split(',')[0]?.trim() || null;
}

function rateLimitKey(
  request: Request,
  info: HandlerInfo | undefined,
  trustForwardedFor: boolean,
): string {
  if (trustForwardedFor) {
    const forwarded = firstForwardedAddress(request.headers.get('x-forwarded-for'));
    if (forwarded !== null) return forwarded;
  }
  return info?.remoteAddress ?? 'unknown';
}

function parseJson(bodyText: string): JsonParseResult {
  try {
    const value: unknown = JSON.parse(bodyText);
    return { ok: true, value };
  } catch {
    return { ok: false, message: MALFORMED_JSON };
  }
}

function createByteLimitStream(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let totalBytes = 0;
  return new TransformStream({
    transform(chunk, controller) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        controller.error(new PayloadTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

async function readBodyTextWithLimit(request: Request): Promise<string> {
  if (request.body === null) {
    return '';
  }

  const decoded = request.body
    .pipeThrough(createByteLimitStream(MAX_EVENT_BODY_BYTES))
    // `TextDecoderStream`'s writable side is typed as `WritableStream<BufferSource>`
    // (broader than the `Uint8Array` chunks our limiter emits), but TypeScript does
    // not model the contravariance of `WritableStream<T>` correctly under the
    // newer DOM/Node lib typings — the chunk types fail to match even though every
    // chunk we feed in is a valid `BufferSource`. Cast through the matching pair
    // shape to keep the existing pipeline.
    .pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>);
  let text = '';
  for await (const chunk of decoded) {
    text += chunk;
  }
  return text;
}

export function createHandler(deps: HandlerDeps) {
  const trustForwardedFor = deps.trustForwardedFor ?? false;
  return async function handler(request: Request, info?: HandlerInfo): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== EVENTS_PATH) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (declaredPayloadTooLarge(request)) {
      return new Response(PAYLOAD_TOO_LARGE, { status: 413 });
    }

    if (deps.rateLimiter) {
      if (!deps.rateLimiter.allow(rateLimitKey(request, info, trustForwardedFor))) {
        return new Response('Too Many Requests', { status: 429 });
      }
    }

    let bodyText: string;
    try {
      bodyText = await readBodyTextWithLimit(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return new Response(PAYLOAD_TOO_LARGE, { status: 413 });
      }
      return new Response(MALFORMED_JSON, { status: 400 });
    }

    const json = parseJson(bodyText);
    if (!json.ok) {
      return new Response(json.message, { status: 400 });
    }

    const parsed = eventPayloadSchema(json.value);
    if (parsed instanceof type.errors) {
      return new Response(
        JSON.stringify({ error: 'invalid event payload', detail: parsed.summary }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }

    const plan = deps.db.sql.public.telemetry_event
      .insert([
        {
          installationId: parsed.installationId,
          version: parsed.version,
          command: parsed.command,
          flags: parsed.flags,
          runtimeName: parsed.runtimeName,
          runtimeVersion: parsed.runtimeVersion,
          os: parsed.os,
          arch: parsed.arch,
          packageManager: parsed.packageManager,
          databaseTarget: parsed.databaseTarget,
          tsVersion: parsed.tsVersion,
          agent: parsed.agent,
          extensions: parsed.extensions,
          exitCode: parsed.exitCode,
        },
      ])
      .build();

    // TODO: use prepared statements once they are implemented for inserts.
    await deps.db.execute(plan);

    return new Response(null, { status: 202 });
  };
}
