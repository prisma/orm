import type { Db } from '../prisma/db';

/** Up to `limit` admins, ordered by email. */
export function getAdmins(db: Db, limit: number) {
  return db.orm.User.where({ role: 'ADMIN' })
    .orderBy((u) => u.email.asc())
    .limit(limit)
    .all();
}
