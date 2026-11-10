import { db } from '../prisma/db';

export async function insertUser(email: string, displayName: string) {
  const plan = db.sql.user
    .insert([{ email, displayName, createdAt: new Date() }])
    .returning('id', 'email')
    .build();
  const rows = await db.query(plan);
  return rows[0] ?? null;
}
