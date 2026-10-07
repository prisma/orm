import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUserPosts(userId: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.forUser(userId).newestFirst().limit(limit).all();
}
