import { errorTemporalUnavailable, errorTemporalUnavailableForDefault } from './errors';

export type TemporalImplementation = typeof Temporal;

export type TemporalUse =
  | { readonly codecId: string; readonly operation: 'decode' | 'encode' }
  | { readonly generatorId: string };

let registered: TemporalImplementation | undefined;

/**
 * Supplies the implementation `temporalImplementation` returns on a runtime that has no global
 * `Temporal`. Only control-plane code calls this; the application runtime registers nothing.
 */
export function registerTemporalImplementation(implementation: TemporalImplementation): void {
  registered = implementation;
}

/**
 * The `Temporal` to use: the runtime's own when it has one, else the registered one. Throws
 * `RUNTIME.TEMPORAL_UNAVAILABLE` when there is neither.
 */
export function temporalImplementation(use: TemporalUse): TemporalImplementation {
  if (typeof Temporal !== 'undefined') {
    return Temporal;
  }
  if (registered !== undefined) {
    return registered;
  }
  throw 'generatorId' in use
    ? errorTemporalUnavailableForDefault(use.generatorId)
    : errorTemporalUnavailable(use.codecId, use.operation);
}
