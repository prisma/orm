import type { DemoOrm } from '../prisma/db';

export async function ormClientGetUserInsights(limit: number, orm: DemoOrm) {
  return orm.User.newestFirst()
    .select('id', 'email', 'kind', 'createdAt')
    .include('posts', (posts) =>
      posts.combine({
        totalPosts: posts.count(),
        latestPost: posts
          .orderBy([(post) => post.createdAt.desc(), (post) => post.id.asc()])
          .limit(1)
          .select('id', 'title', 'createdAt'),
      }),
    )
    .limit(limit)
    .all();
}
