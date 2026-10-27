import { blindCast } from '@internal/utils/casts';
import type { Temporal } from 'temporal-spec';
import { errorTemporalUnavailable, errorTemporalUnavailableForDefault } from './errors';

export type TemporalImplementation = typeof Temporal;

/** What needed `Temporal`, as the `RUNTIME.TEMPORAL_UNAVAILABLE` error reports it. */
export type TemporalUnavailableMeta =
  | { readonly codecId: string; readonly operation: 'decode' }
  | { readonly generatorId: string };

let fallback: TemporalImplementation | undefined;

/**
 * Sets the implementation `requireTemporal` returns when the runtime has no global `Temporal`.
 * The value is held once per process. Only the control entry calls this.
 */
export function setFallbackTemporal(implementation: TemporalImplementation): void {
  fallback = implementation;
}

/**
 * The `Temporal` to use: the runtime's own when it has one, else the fallback. Throws
 * `RUNTIME.TEMPORAL_UNAVAILABLE` when there is neither.
 */
export function requireTemporal(meta: TemporalUnavailableMeta): TemporalImplementation {
  const runtimeTemporal = blindCast<
    { readonly Temporal?: TemporalImplementation },
    'globalThis holds the runtime Temporal when the runtime has one'
  >(globalThis).Temporal;
  if (runtimeTemporal !== undefined) {
    return runtimeTemporal;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw 'generatorId' in meta
    ? errorTemporalUnavailableForDefault(meta.generatorId)
    : errorTemporalUnavailable(meta.codecId, meta.operation);
}
