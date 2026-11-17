import type { Db } from '../prisma/db';

/** A new user; MySQL generates the id. */
export function createUser(db: Db, email: string) {
  return db.orm.User.create({ email, role: 'USER' });
}

/** Makes the user an admin and returns the updated row, or `null` when there is no such user. */
export function promoteUser(db: Db, id: number) {
  return db.orm.User.where({ id }).update({ role: 'ADMIN' });
}

/** Creates the user with this email, or makes the existing one an admin. */
export function upsertAdmin(db: Db, email: string) {
  return db.orm.User.upsert({
    create: { email, role: 'USER' },
    update: { role: 'ADMIN' },
    conflictOn: { email },
  });
}

/** Deletes the user and returns the deleted row, or `null` when there is no such user. */
export function deleteUser(db: Db, id: number) {
  return db.orm.User.where({ id }).delete();
}

/** Makes every user an admin and returns how many rows changed. */
export function promoteEveryUser(db: Db) {
  return db.orm.User.where({ role: 'USER' }).updateAndCount({ role: 'ADMIN' });
}
