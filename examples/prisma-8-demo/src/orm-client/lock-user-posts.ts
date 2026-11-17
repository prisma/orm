import type { DemoOrm } from '../prisma/db';

export async function ormClientLockUserPosts(userId: string, orm: DemoOrm) {
  return orm.Post.forUser(userId).newestFirst().select('id', 'title').forUpdate().all();
}
