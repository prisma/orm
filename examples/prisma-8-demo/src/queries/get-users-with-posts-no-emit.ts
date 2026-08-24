import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from '../prisma-no-emit/context';

export async function getUsersWithPosts(runtime: Runtime, limit = 10) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'email', 'createdAt')
    .include('posts', (post) =>
      post.orderBy((p) => p.createdAt.desc()).select('id', 'title', 'createdAt'),
    )
    .limit(limit)
    .all();
}
