import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserRow = DefaultModelRow<Contract, 'User'>;

export interface OrmClientCreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly kind: 'admin' | 'user';
  readonly createdAt: Temporal.Instant;
}

export async function ormClientCreateUser(data: OrmClientCreateUserInput, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'email', 'kind').create({
    id: toUserId(data.id),
    email: data.email,
    displayName: data.displayName,
    kind: data.kind,
    createdAt: data.createdAt,
  });
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}
