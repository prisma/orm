import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';

/**
 * The runtime generator behind `temporal.createdAt()` / `temporal.updatedAt()`: `new Date()`, one value per ORM operation (`stability: 'query'`), so a bulk create shares one timestamp across its documents. The Mongo adapter's runtime descriptor registers it, as the Postgres adapter registers the SQL family's.
 */
export function timestampNowRuntimeGenerator(): RuntimeMutationDefaultGenerator {
  return { id: TIMESTAMP_NOW_GENERATOR_ID, generate: () => new Date(), stability: 'query' };
}
