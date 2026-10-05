import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';
import { createdSince, postSummary } from './fragments';

/**
 * Users created since a point in time, each with the summaries of their posts from the same period.
 * `createdSince` filters both models; `postSummary` shapes the included posts.
 */
export async function ormClientGetRecentUsers(
  since: Temporal.Instant,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.User.where(createdSince(since))
    .include('posts', (posts) =>
      posts
        .where(createdSince(since))
        .orderBy((post) => post.createdAt.asc())
        .apply(postSummary),
    )
    .orderBy((user) => user.createdAt.asc())
    .limit(limit)
    .all();
}
