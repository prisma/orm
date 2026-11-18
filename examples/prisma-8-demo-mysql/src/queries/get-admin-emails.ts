import type { Db } from '../prisma/db';

/** Admin ids and emails through the SQL builder. */
export function getAdminEmails(db: Db) {
  return db.query(
    db.sql.User.select('id', 'email')
      .where((f, fns) => fns.eq(f.role, 'ADMIN'))
      .orderBy('id')
      .build(),
  );
}
