import type { RuntimeErrorEnvelope } from '../shared/runtime-error';
import { runtimeError } from '../shared/runtime-error';

export type { RuntimeErrorEnvelope } from '../shared/runtime-error';
export { isRuntimeError, runtimeError } from '../shared/runtime-error';

/**
 * Stable code emitted by the runtime when an in-flight `execute()`
 * is cancelled via the per-query `AbortSignal`. The envelope's
 * `details.phase` distinguishes where the abort was observed:
 *
 * - `'encode'` — abort fired during `encodeParams` (SQL) or
 *   `resolveValue` (Mongo).
 * - `'decode'` — abort fired during `decodeRow` / `decodeField`.
 * - `'stream'` — abort fired between rows or before any codec call
 *   (already-aborted at entry).
 * - `'beforeEncode'` / `'onRow'` — abort fired on entry to or during
 *   the corresponding middleware phase
 *   (cooperative cancellation per the param-transform seam).
 */
export const RUNTIME_ABORTED = 'RUNTIME.ABORTED' as const;

/** Discriminator placed in `details.phase` of a `RUNTIME.ABORTED` envelope. */
export type RuntimeAbortedPhase = 'encode' | 'decode' | 'stream' | 'beforeEncode' | 'onRow';

/**
 * Construct a `RUNTIME.ABORTED` envelope. Phase distinguishes where the
 * abort was observed — codec call sites (`encode` / `decode` / `stream`)
 * or operation-specific middleware seams, as
 * enumerated on {@link RuntimeAbortedPhase}. Cause carries
 * `signal.reason` verbatim from the platform — native abort produces a
 * `DOMException`, explicit `controller.abort(reason)` produces whatever
 * the caller passed. No synthesis happens here.
 */
export function runtimeAborted(phase: RuntimeAbortedPhase, cause?: unknown): RuntimeErrorEnvelope {
  const envelope = runtimeError(RUNTIME_ABORTED, `Operation aborted during ${phase}`, { phase });
  return Object.assign(envelope, { cause });
}
