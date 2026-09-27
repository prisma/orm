import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { MongoRuntimeMutationDefaultGenerator } from '@internal/mongo-runtime';

/**
 * The runtime generator behind `temporal.createdAt()` / `temporal.updatedAt()`: `new Date()`, one value per ORM operation (`stability: 'query'`), so a bulk create shares one timestamp across its documents. The Mongo adapter's runtime descriptor registers it, as the Postgres adapter registers the SQL family's.
 */
export function timestampNowRuntimeGenerator(): MongoRuntimeMutationDefaultGenerator {
  return { id: TIMESTAMP_NOW_GENERATOR_ID, generate: () => new Date(), stability: 'query' };
}
