import type { RuntimeAbortedPhase } from './runtime-error';
import { runtimeAborted } from './runtime-error';

/**
 * Throw a phase-tagged `RUNTIME.ABORTED` envelope if the supplied
 * context is already aborted at the precheck site. Centralises the
 * `if (ctx.signal?.aborted) throw runtimeAborted(...)` pattern that
 * every codec dispatch site (and the `beforeEncode` middleware phase)
 * repeats. Accepts both the framework `CodecCallContext` and the
 * `ActivityContext`; both expose `signal?: AbortSignal`.
 */
export function checkAborted(
  ctx: { readonly signal?: AbortSignal },
  phase: RuntimeAbortedPhase,
): void {
  if (ctx.signal?.aborted) {
    throw runtimeAborted(phase, ctx.signal.reason);
  }
}

/**
 * Race a per-cell `Promise.all` (or any other in-flight work promise) against
 * the supplied abort signal so the runtime returns `RUNTIME.ABORTED` promptly
 * even when codec bodies ignore the signal. In-flight bodies that ignore the
 * signal are abandoned and run to completion in the background — the
 * cooperative-cancellation contract documented in ADR 204.
 *
 * Call sites still SHOULD pre-check `signal.aborted` and short-circuit with
 * a phase-tagged `RUNTIME.ABORTED` envelope before invoking this helper —
 * that path is the canonical "aborted at entry" surface and avoids
 * scheduling the work promise. As a defensive belt-and-braces, this helper
 * also handles the already-aborted case internally: `AbortSignal` does not
 * replay past abort events to listeners registered after the abort, so we
 * inspect `signal.aborted` synchronously and reject with the sentinel
 * before installing the listener. The rejection is still attributed to the
 * abort path via the sentinel-identity check.
 *
 * Distinguishing the rejection source is load-bearing for AC-ERR4
 * (`RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` pass through unchanged).
 * The semantically equivalent `abortable(signal)` helper in
 * `@internal/utils` rejects with `signal.reason ?? new DOMException(...)`,
 * which is not stably distinguishable from a codec-thrown error by identity
 * alone (a fresh fallback DOMException is allocated per call). We instead
 * track abort attribution with a unique sentinel: only the `onAbort` listener
 * installed here ever rejects with the sentinel, so an `error === sentinel`
 * identity check after the race is unambiguous.
 *
 * Lives in `framework-components` (rather than the SQL family, where it
 * originated in m2) so every family runtime that needs cooperative
 * cancellation around a codec-dispatch `Promise.all` (SQL encode + decode
 * today, Mongo encode in m3) shares the same attribution logic.
 */
export async function raceAgainstAbort<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  phase: RuntimeAbortedPhase,
): Promise<T> {
  if (signal === undefined) {
    return await work;
  }
  const sentinel: { reason: unknown } = { reason: undefined };
  let onAbort: (() => void) | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      sentinel.reason = signal.reason;
      reject(sentinel);
      return;
    }
    onAbort = () => {
      sentinel.reason = signal.reason;
      reject(sentinel);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([work, abortPromise]);
  } catch (error) {
    if (error === sentinel) {
      throw runtimeAborted(phase, sentinel.reason);
    }
    throw error;
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
