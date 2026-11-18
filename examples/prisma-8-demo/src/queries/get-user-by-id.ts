import { db } from '../prisma/db';

export async function getUserById(userId: string) {
  const plan = db.sql.public.user
    .select('id', 'email', 'createdAt')
    .where((f, fns) => fns.eq(f.id, userId))
    .limit(1)
    .build();
  const rows = await db.query(plan);
  return rows[0] ?? null;
}
