import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

type UserRow = DefaultModelRow<Contract, 'User'>;

export interface OrmClientCreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: Date | string;
}

export async function ormClientCreateUser(data: OrmClientCreateUserInput) {
  return db.orm.User.select('id', 'email').create({
    id: toUserId(data.id),
    email: data.email,
    displayName: data.displayName,
    createdAt: toUserCreatedAt(data.createdAt),
  });
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}

function toUserCreatedAt(value: Date | string): UserRow['createdAt'] {
  return (value instanceof Date ? value : new Date(value)) as UserRow['createdAt'];
}
