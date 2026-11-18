import type { DemoOrm } from '../prisma/db';
import { createdSince, postSummary } from './fragments';

/**
 * Users created since a point in time, each with the summaries of their posts from the same period.
 * `createdSince` is one scope for both models; `postSummary` shapes the included posts.
 */
export async function ormClientGetRecentUsers(
  since: Temporal.Instant,
  limit: number,
  orm: DemoOrm,
) {
  return orm.User.with(createdSince(since))
    .select('id', 'email')
    .include('posts', (posts) =>
      posts
        .with(createdSince(since))
        .orderBy((post) => post.createdAt.asc())
        .with(postSummary),
    )
    .orderBy((user) => user.createdAt.asc())
    .limit(limit)
    .all();
}
