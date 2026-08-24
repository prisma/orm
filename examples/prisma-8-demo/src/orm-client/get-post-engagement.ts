import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

/**
 * Reads the three engagement counters side by side.
 *
 * All three are integers in the database, and all three arrive in a different
 * JavaScript type, because each column picked a different representation:
 * `viewCount` is `BigIntNumber` and arrives as a `number`, `impressionCount` is
 * plain `BigInt` and arrives as a `bigint`, and `reachScore` is `UnboundedInt`
 * and arrives as a `bigint` that is exact past the 64-bit range where an
 * `impressionCount` would already have overflowed.
 */
export async function ormClientGetPostEngagement(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.select('title', 'viewCount', 'impressionCount', 'reachScore')
    .orderBy([(post) => post.title.asc()])
    .limit(limit)
    .all();
}
