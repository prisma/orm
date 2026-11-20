import type { NoEmitOrm } from '../prisma-no-emit/runtime';

export async function getUsersWithPosts(orm: NoEmitOrm, limit = 10) {
  return orm.User.select('id', 'email', 'createdAt')
    .include('posts', (post) =>
      post.orderBy((p) => p.createdAt.desc()).select('id', 'title', 'createdAt'),
    )
    .limit(limit)
    .all();
}
