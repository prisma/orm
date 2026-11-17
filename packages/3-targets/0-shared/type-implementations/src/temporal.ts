import type { Temporal } from 'temporal-spec';

export type TemporalImplementation = typeof Temporal;

let fallback: TemporalImplementation | undefined;

/**
 * Sets the implementation `findTemporal` returns when the runtime has no global `Temporal`. The value is held once per process. Only a target's control entry calls this.
 */
export function setFallbackTemporal(implementation: TemporalImplementation): void {
  fallback = implementation;
}

/**
 * The `Temporal` to use: the runtime's own when it has one, else the fallback, else `undefined`, for the target to raise its own error.
 */
export function findTemporal(): TemporalImplementation | undefined {
  const runtimeTemporal: unknown = Reflect.get(globalThis, 'Temporal');
  return isTemporalImplementation(runtimeTemporal) ? runtimeTemporal : fallback;
}

function isTemporalImplementation(value: unknown): value is TemporalImplementation {
  return typeof value === 'object' && value !== null;
}
