import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';
import { createdSince, postSummary } from './scopes';

/**
 * Users created since a point in time, each with the summaries of their posts from the same period.
 * `createdSince` is one scope for both models; `postSummary` shapes the included posts.
 */
export async function ormClientGetRecentUsers(
  since: Temporal.Instant,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.User.apply(createdSince(since))
    .select('id', 'email')
    .include('posts', (posts) =>
      posts
        .apply(createdSince(since))
        .orderBy((post) => post.createdAt.asc())
        .apply(postSummary),
    )
    .orderBy((user) => user.createdAt.asc())
    .limit(limit)
    .all();
}
