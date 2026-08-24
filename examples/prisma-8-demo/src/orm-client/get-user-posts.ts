import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUserPosts(userId: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.forUser(userId)
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();
}
