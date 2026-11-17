import type { DemoOrm } from '../prisma/db';

export async function ormClientGetUserPosts(userId: string, limit: number, orm: DemoOrm) {
  return orm.Post.forUser(userId).newestFirst().limit(limit).all();
}
