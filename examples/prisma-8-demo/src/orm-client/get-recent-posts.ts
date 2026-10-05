import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { orderByField } from '@prisma/orm-postgres/orm-client';
import type { Direction } from '@prisma/orm-postgres/relational-core/ast';
import { createOrmClient } from './client';
import { createdSince, postSummary } from './fragments';

/**
 * Posts created since a point in time, ordered by a field named in the request. `orderByField` throws
 * `ORM.ARGUMENT_INVALID` for a name other than `title` or `createdAt` before the query runs.
 */
export async function ormClientGetRecentPosts(
  since: Temporal.Instant,
  orderBy: string,
  direction: Direction,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.Post.where(createdSince(since))
    .orderBy(orderByField(db.Post, orderBy, direction, ['title', 'createdAt']))
    .apply(postSummary)
    .limit(limit)
    .all();
}
