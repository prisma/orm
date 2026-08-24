import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUserInsights(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.newestFirst()
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
