import { findTemporal, type TemporalImplementation } from '@internal/type-implementations/temporal';
import { errorTemporalUnavailable, errorTemporalUnavailableForDefault } from './errors';

/** What needed `Temporal`, as the `RUNTIME.TEMPORAL_UNAVAILABLE` error reports it. */
export type TemporalUnavailableMeta =
  | { readonly codecId: string; readonly operation: 'decode' }
  | { readonly generatorId: string };

/**
 * The `Temporal` to use: the runtime's own when it has one, else the fallback. Throws
 * `RUNTIME.TEMPORAL_UNAVAILABLE` when there is neither.
 */
export function requireTemporal(meta: TemporalUnavailableMeta): TemporalImplementation {
  const temporal = findTemporal();
  if (temporal !== undefined) {
    return temporal;
  }
  throw 'generatorId' in meta
    ? errorTemporalUnavailableForDefault(meta.generatorId)
    : errorTemporalUnavailable(meta.codecId, meta.operation);
}
