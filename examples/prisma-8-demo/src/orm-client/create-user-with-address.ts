import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { AddressInput, Contract } from '../prisma/contract';
import { createOrmClient } from './client';

type UserRow = DefaultModelRow<Contract, 'User'>;

export interface OrmClientCreateUserWithAddressInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly kind: 'admin' | 'user';
  readonly createdAt: Temporal.Instant;
  readonly address: AddressInput;
}

export async function ormClientCreateUserWithAddress(
  data: OrmClientCreateUserWithAddressInput,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'email', 'kind', 'address').create({
    id: toUserId(data.id),
    email: data.email,
    displayName: data.displayName,
    kind: data.kind,
    createdAt: data.createdAt,
    address: data.address,
  });
}

function toUserId(value: string): UserRow['id'] {
  return value as UserRow['id'];
}
