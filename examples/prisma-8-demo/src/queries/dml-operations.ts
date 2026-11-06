import { db } from '../prisma/db';

export async function insertUser(email: string, displayName: string) {
  const plan = db.sql.public.user
    .insert([{ email, displayName, kind: 'user' }])
    .returning('id', 'email')
    .build();
  const rows = await db.query(plan);
  return rows[0] ?? null;
}

export async function updateUser(userId: string, newEmail: string) {
  const plan = db.sql.public.user
    .update({ email: newEmail })
    .where((f, fns) => fns.eq(f.id, userId))
    .returning('id', 'email')
    .build();
  const rows = await db.query(plan);
  return rows[0] ?? null;
}

export async function deleteUser(userId: string) {
  const plan = db.sql.public.user
    .delete()
    .where((f, fns) => fns.eq(f.id, userId))
    .returning('id', 'email')
    .build();
  const rows = await db.query(plan);
  return rows[0] ?? null;
}
