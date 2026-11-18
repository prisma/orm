import type { DemoOrm } from '../prisma/db';
import { createdBefore, postSummary } from './fragments';

export interface GetFilteredPostsInput {
  readonly userId?: string | undefined;
  readonly before?: Temporal.Instant | undefined;
}

/**
 * Summaries of the newest posts, filtered by author and by creation time only when the input names them.
 */
export async function ormClientGetFilteredPosts(
  input: GetFilteredPostsInput,
  limit: number,
  orm: DemoOrm,
) {
  return orm.Post.with((posts) =>
    input.userId !== undefined ? posts.where({ userId: input.userId }) : posts,
  )
    .with((posts) =>
      input.before !== undefined ? posts.where(createdBefore(input.before)) : posts,
    )
    .orderBy((post) => post.createdAt.desc())
    .with(postSummary)
    .limit(limit)
    .all();
}
