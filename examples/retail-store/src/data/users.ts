import type { FieldInputTypes } from '../contract';
import type { Db } from '../db';

export function findUsers(db: Db) {
  return db.orm.users.all();
}

export function findUserById(db: Db, id: string) {
  return db.orm.users.where({ id }).first();
}

export function createUser(db: Db, data: Omit<FieldInputTypes['__unbound__']['User'], 'id'>) {
  return db.orm.users.create(data);
}
