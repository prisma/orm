import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { RuntimeMutationDefaultGenerator } from '@internal/sql-runtime';

/**
 * Builds the canonical runtime-plane generator for the wall-clock-now
 * mutation default. Returns `new Date()`; semantics are target-agnostic
 * so all SQL targets share this single implementation.
 *
 * Declares `stability: 'query'` so a single ORM bulk operation
 * (e.g. `createAll([...])`) shares one timestamp across every row and
 * every timestamp-defaulted column. Matches Prisma 6's `@updatedAt`
 * semantics: one `new Date()` per lowered mutation, not per row.
 *
 * Lives in a runtime-plane-only module so the control-plane
 * `timestamp-now-generator.ts` (descriptor + authoring presets) stays
 * free of `@internal/sql-runtime` imports.
 */
export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    generate: () => new Date(),
    stability: 'query',
  };
}
