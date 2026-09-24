import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';

/**
 * The runtime generator behind `temporal.createdAt()` / `temporal.updatedAt()`: `new Date()`, one value per ORM operation (`stability: 'query'`), so a bulk create shares one timestamp across its documents.
 *
 * Shaped structurally to `MongoRuntimeMutationDefaultGenerator` rather than typed by it: the adapter does not import `@internal/mongo-runtime` (see the runtime descriptor in `../exports/runtime.ts`).
 */
export function timestampNowRuntimeGenerator(): {
  readonly id: typeof TIMESTAMP_NOW_GENERATOR_ID;
  readonly generate: () => Date;
  readonly stability: 'query';
} {
  return { id: TIMESTAMP_NOW_GENERATOR_ID, generate: () => new Date(), stability: 'query' };
}
