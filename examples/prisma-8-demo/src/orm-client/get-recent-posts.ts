import { orderByField } from '@prisma/orm-postgres/orm-client';
import type { DemoOrm } from '../prisma/db';
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
  orm: DemoOrm,
) {
  return orm.Post.with(createdSince(since))
    .orderBy(orderByField(orm.Post, orderBy, direction, ['title', 'createdAt']))
    .with(postSummary)
    .limit(limit)
    .all();
}
