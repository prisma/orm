import type { SqliteRuntime } from '@prisma/orm-sqlite/runtime';
import { createOrmClient } from './client';

/**
 * Reads the two engagement counters side by side.
 *
 * Both are INTEGER columns, and both arrive in a different JavaScript type
 * because each picked a different representation: `viewCount` is
 * `BigIntNumber` and arrives as a `number`, `impressionCount` is plain `BigInt`
 * and arrives as a `bigint`. SQLite offers no third option — `UnboundedInt`
 * needs storage wider than 64 bits, which SQLite has not got.
 */
export async function ormClientGetPostEngagement(limit: number, runtime: SqliteRuntime) {
  const db = createOrmClient(runtime);
  return db.Post.select('title', 'viewCount', 'impressionCount')
    .orderBy([(post) => post.title.asc()])
    .limit(limit)
    .all();
}
