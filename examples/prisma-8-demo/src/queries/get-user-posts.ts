import { db } from '../prisma/db';

export async function getUserPosts(userId: string, limit = 100) {
  const plan = db.sql.public.post
    .select('id', 'title', 'userId', 'createdAt', 'embedding')
    .where((f, fns) => fns.eq(f.userId, userId))
    .limit(limit)
    .build();
  return db.query(plan);
}
