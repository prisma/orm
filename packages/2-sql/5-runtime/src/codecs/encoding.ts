import {
  checkAborted,
  raceAgainstAbort,
  runtimeError,
} from '@internal/framework-components/runtime';
import {
  type AnyQueryAst,
  type Codec,
  type CodecRef,
  type ContractCodecRegistry,
  collectOrderedParamRefs,
  type SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { isInternalError } from '@internal/utils/internal-error';
import { isStructuredError } from '@internal/utils/structured-error';

export interface ParamMetadata {
  readonly codec: CodecRef | undefined;
  readonly name: string | undefined;
}

const NO_METADATA: ParamMetadata = Object.freeze({
  codec: undefined,
  name: undefined,
});

// Indexed by Postgres-style deduped slot order (matches the adapter's
// `collectOrderedParamRefs` walk). For SQLite's non-deduped renderer,
// `lowered.params` has one entry per occurrence: positions past
// `refs.length` fall back to `NO_METADATA` in encodeParamsWithMetadata,
// so codec'd repeats round-trip unchanged — a limitation that will be
// revisited when SQLite prepared statements ship and each adapter
// carries codec metadata on its `LoweredParam` slots directly.
export function deriveParamMetadata(ast: AnyQueryAst): readonly ParamMetadata[] {
  return collectOrderedParamRefs(ast).map((ref): ParamMetadata => {
    return { codec: ref.codec, name: ref.name };
  });
}

function resolveParamCodec(
  metadata: ParamMetadata,
  contractCodecs: ContractCodecRegistry | undefined,
): Codec | undefined {
  if (metadata.codec && contractCodecs) {
    return contractCodecs.forCodecRef(metadata.codec);
  }
  return undefined;
}

function paramLabel(metadata: ParamMetadata, paramIndex: number): string {
  return metadata.name ?? `param[${paramIndex}]`;
}

function wrapEncodeFailure(
  error: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  codecId: string,
): never {
  if (isInternalError(error)) throw error;
  const label = paramLabel(metadata, paramIndex);
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codecId}': ${message}`,
    { label, codec: codecId, paramIndex },
  );
  wrapped.cause = error;
  throw wrapped;
}

/**
 * Encodes a single parameter through its codec. Always awaits codec.encode so a Promise can never leak into the driver, even if a sync-authored codec is lifted to async by the codec factory. Structured envelopes thrown by the codec body (anything passing `isStructuredError`) and an `InternalError` pass through unchanged; all other failures are wrapped in `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original error attached on `cause`.
 *
 * `ctx` is forwarded verbatim to `codec.encode` so codec authors who opt into the `(value, ctx)` arity see the same `SqlCodecCallContext` the runtime built for the surrounding `query` or `execute` call. The ctx is always present; its `signal` field may be `undefined`. Encode call sites do not populate `ctx.column` — encode-time column context is the middleware's domain.
 */
export async function encodeParam(
  value: unknown,
  paramRef: {
    readonly codec?: CodecRef;
    readonly name?: string;
  },
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<unknown> {
  return encodeParamValue(
    value,
    { codec: paramRef.codec, name: paramRef.name },
    paramIndex,
    ctx,
    contractCodecs,
  );
}

async function encodeParamValue(
  value: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs: ContractCodecRegistry | undefined,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(metadata, contractCodecs);
  if (!codec) {
    return value;
  }

  if (metadata.codec?.many) {
    if (!Array.isArray(value)) {
      wrapEncodeFailure(
        new TypeError(`expected an array for many-typed parameter, got ${typeof value}`),
        metadata,
        paramIndex,
        codec.id,
      );
    }
    const encoded: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const elem = value[i];
      if (elem === null || elem === undefined) {
        encoded.push(null);
        continue;
      }
      try {
        encoded.push(await codec.encode(elem, ctx));
      } catch (error) {
        if (isStructuredError(error)) throw error;
        wrapEncodeFailure(error, metadata, paramIndex, codec.id);
      }
    }
    return encoded;
  }

  try {
    return await codec.encode(value, ctx);
  } catch (error) {
    // Any structured envelope (dotted `code` per `isStructuredError`) is
    // stable by construction — let it pass through unchanged. This covers
    // every `runtimeError`-built envelope, plain `structuredError`
    // envelopes from extension codecs (e.g. a codec-authored
    // `RUNTIME.ENCODE_FAILED` — no double wrap), codec-authored
    // `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` (per-library JSON-with-
    // schema codecs validate inside `encode` per ADR 208 § Case J), and
    // any future stable code thrown from a codec body. Symmetric with the
    // decode-side guard.
    if (isStructuredError(error)) throw error;
    wrapEncodeFailure(error, metadata, paramIndex, codec.id);
  }
}

/**
 * Encodes all parameters concurrently via `Promise.all`. Per parameter, sync-and async-authored codecs share the same path: `codec.encode → await → return`. Param-level failures are wrapped in `RUNTIME.ENCODE_FAILED`.
 *
 * When `ctx.signal` is provided:
 *
 * - **Already-aborted at entry** short-circuits with `RUNTIME.ABORTED` (`{ phase: 'encode' }`) before any `codec.encode` call is made — codecs can pin this with a per-call counter that stays at zero.
 * - **Mid-flight abort** races the per-param `Promise.all` against `abortable(ctx.signal)`. The runtime returns `RUNTIME.ABORTED` promptly even if codec bodies ignore the signal; the in-flight bodies are abandoned and run to completion in the background (cooperative cancellation, see ADR 204).
 * - Existing structured envelopes (any dotted-code error passing `isStructuredError`, e.g. `RUNTIME.ENCODE_FAILED`) that surface from a codec body before the runtime observes the abort pass through unchanged (no double wrap).
 */
export async function encodeParams(
  plan: SqlExecutionPlan,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<readonly unknown[]> {
  return encodeParamsWithMetadata(plan.params, deriveParamMetadata(plan.ast), ctx, contractCodecs);
}

export async function encodeParamsWithMetadata(
  values: readonly unknown[],
  metadata: readonly ParamMetadata[],
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<readonly unknown[]> {
  checkAborted(ctx, 'encode');
  const signal = ctx.signal;

  if (values.length === 0) {
    return values;
  }

  const tasks = values.map((value, i) =>
    encodeParamValue(value, metadata[i] ?? NO_METADATA, i, ctx, contractCodecs),
  );

  const settled = await raceAgainstAbort(Promise.all(tasks), signal, 'encode');
  return Object.freeze(settled);
}
