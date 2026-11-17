import { db } from '../prisma/db';

export async function getUsers(limit = 10) {
  const plan = db.sql.user.select('id', 'email', 'displayName', 'createdAt').limit(limit).build();
  return db.query(plan);
}
