import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

export async function ormClientFindUserById(id: string) {
  return db.orm.User.first({ id: toUserId(id) });
}

function toUserId(value: string): UserId {
  return value as UserId;
}
