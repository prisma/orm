import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { orderByField } from '@prisma/orm-postgres/orm-client';
import { createOrmClient } from './client';
import { createdSince, postSummary } from './fragments';

/**
 * Posts created since a point in time, ordered by a field and direction named in the request. `orderByField`
 * throws `ORM.ARGUMENT_INVALID` for a name other than `title` or `createdAt`, or a direction other than `asc`
 * or `desc`, before the query runs.
 */
export async function ormClientGetRecentPosts(
  since: Temporal.Instant,
  orderBy: string,
  direction: string | undefined,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.Post.with(createdSince(since))
    .orderBy(orderByField(db.Post, orderBy, direction, ['title', 'createdAt']))
    .with(postSummary)
    .limit(limit)
    .all();
}
