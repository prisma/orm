import type { DemoOrm } from '../prisma/db';

/**
 * Reads the three engagement counters side by side.
 *
 * All three are integers in the database, and all three arrive in a different
 * JavaScript type, because each column picked a different representation:
 * `viewCount` is `BigInt(as: number)` and arrives as a `number`, `impressionCount` is
 * plain `BigInt` and arrives as a `bigint`, and `reachScore` is `BigInt(storage: numeric)`
 * and arrives as a `bigint` that is exact past the 64-bit range where an
 * `impressionCount` would already have overflowed.
 */
export async function ormClientGetPostEngagement(limit: number, orm: DemoOrm) {
  return orm.Post.select('title', 'viewCount', 'impressionCount', 'reachScore')
    .orderBy([(post) => post.title.asc()])
    .limit(limit)
    .all();
}
