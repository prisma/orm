import type { CodecCallContext } from '@internal/framework-components/codec';
import {
  checkAborted,
  raceAgainstAbort,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { MongoCodecRegistry } from '@internal/mongo-codec';
import type { Document, MongoValue } from '@internal/mongo-value';
import { MongoParamRef } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';

/**
 * Resolves a `MongoValue` (which may contain `MongoParamRef` leaves) into the
 * driver-ready wire shape. When a leaf has a `codecId` and the registry has a
 * codec for it, the codec's async `encode` is awaited so codecs may perform
 * asynchronous work (e.g. lookups, key derivations).
 *
 * Object/array nodes dispatch their child resolutions concurrently via
 * `Promise.all` so independent leaves encode in parallel.
 *
 * Codec encode failures are wrapped in a `RUNTIME.ENCODE_FAILED` envelope
 * (mirroring SQL's `wrapEncodeFailure` shape) with `{ label, codec }` details
 * and the original error attached on `cause`. A structured envelope (any error
 * with a dotted `code`, per `isStructuredError`) is re-thrown verbatim so
 * codec-raised envelopes and nested resolvers don't get double-wrapped.
 *
 * `ctx: CodecCallContext` is forwarded verbatim to every
 * `codec.encode(value, ctx)` call. The same `ctx` reference is also passed
 * to nested `resolveValue` invocations so codec authors observe **signal
 * identity** across the entire recursive walk for one `runtime.query()`.
 *
 * Abort observation (only when `ctx.signal` is provided):
 *
 * - **Already-aborted at entry** — every recursive call pre-checks
 *   `ctx.signal.aborted` and short-circuits with
 *   `RUNTIME.ABORTED { phase: 'encode' }` before any codec is invoked.
 * - **Mid-flight abort** — each per-level `Promise.all` races against the
 *   signal via `raceAgainstAbort`. The runtime returns
 *   `RUNTIME.ABORTED { phase: 'encode' }` promptly even if codec bodies
 *   ignore the signal; in-flight bodies run to completion in the background
 *   (cooperative cancellation, see ADR 204).
 * - `RUNTIME.ENCODE_FAILED` envelopes thrown by a codec body before the
 *   runtime sees the abort pass through unchanged (AC-ERR4).
 */
export async function resolveValue(
  value: MongoValue,
  codecs: MongoCodecRegistry,
  ctx: CodecCallContext,
): Promise<unknown> {
  checkAborted(ctx, 'encode');
  const signal = ctx.signal;

  if (value instanceof MongoParamRef) {
    if (value.codecId) {
      const codec = codecs.get(value.codecId);
      if (codec?.encode) {
        try {
          // Race even leaf scalar encodes against the signal so a leaf
          // `MongoParamRef` (e.g. a simple field filter, or any leaf reached
          // from `MongoAdapterImpl.#resolveDocument()` outside an enclosing
          // `Promise.all`) surfaces `RUNTIME.ABORTED` promptly instead of
          // blocking on a slow codec body.
          const encoded = codec.encode(value.value, ctx);
          return await raceAgainstAbort(encoded, signal, 'encode');
        } catch (error) {
          wrapEncodeFailure(error, value, codec.id);
        }
      }
    }
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    const tasks = Promise.all(value.map((v) => resolveValue(v, codecs, ctx)));
    return raceAgainstAbort(tasks, signal, 'encode');
  }
  const entries = Object.entries(value);
  const all = Promise.all(entries.map(([, val]) => resolveValue(val, codecs, ctx)));
  const resolved = await raceAgainstAbort(all, signal, 'encode');
  const result: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry) {
      result[entry[0]] = resolved[i];
    }
  }
  return result;
}

/**
 * Resolves a draft slot value — which may be `MongoParamRef`, a primitive, a
 * nested plain-object, or an array — into the corresponding wire value.
 * Mirrors `resolveValue`'s traversal strategy but accepts `unknown` so it can
 * handle pipeline stage documents whose field types cannot be narrowed to
 * `MongoValue` statically (e.g. `$geoNear.near: unknown`).
 */
async function resolveDraftSlot(
  value: unknown,
  codecs: MongoCodecRegistry,
  ctx: CodecCallContext,
): Promise<unknown> {
  if (value instanceof MongoParamRef) {
    return resolveValue(value, codecs, ctx);
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const tasks = Promise.all(value.map((v: unknown) => resolveDraftSlot(v, codecs, ctx)));
    return raceAgainstAbort(tasks, ctx.signal, 'encode');
  }
  return resolveDraftDoc(
    blindCast<
      Record<string, unknown>,
      'narrowed by instanceof/typeof guards: non-null, non-Date, non-array object'
    >(value),
    codecs,
    ctx,
  );
}

/**
 * Resolves a pipeline stage draft document by walking every entry and
 * forwarding to {@link resolveDraftSlot}. Used by `MongoAdapterImpl.resolveParams`
 * for aggregate pipeline stages, which carry `unknown`-typed fields (e.g.
 * `$geoNear.near`) alongside filter sub-documents that may contain
 * `MongoParamRef` leaves.
 */
export async function resolveDraftDoc(
  doc: Record<string, unknown>,
  codecs: MongoCodecRegistry,
  ctx: CodecCallContext,
): Promise<Document> {
  checkAborted(ctx, 'encode');
  const entries = Object.entries(doc);
  const all = Promise.all(entries.map(([, val]) => resolveDraftSlot(val, codecs, ctx)));
  const resolved = await raceAgainstAbort(all, ctx.signal, 'encode');
  const result: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry) {
      result[entry[0]] = resolved[i];
    }
  }
  return result;
}

function paramRefLabel(ref: MongoParamRef, codecId: string): string {
  return ref.name ?? codecId;
}

/**
 * Every encode failure names the parameter. A codec's own `RUNTIME.ENCODE_FAILED` keeps its code and details, with the label added; any other structured envelope passes through unchanged; everything else is wrapped in a `RUNTIME.ENCODE_FAILED` envelope. The original error is the `cause`.
 */
function wrapEncodeFailure(error: unknown, ref: MongoParamRef, codecId: string): never {
  const codecDetails = isStructuredError(error) ? error.meta : undefined;
  if (isStructuredError(error) && error.code !== 'RUNTIME.ENCODE_FAILED') {
    throw error;
  }
  const label = paramRefLabel(ref, codecId);
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codecId}': ${message}`,
    { ...codecDetails, label, codec: codecId },
  );
  wrapped.cause = error;
  throw wrapped;
}
