import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { AddressInput, Contract } from '../prisma/contract';
import type { DemoOrm } from '../prisma/db';

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
  orm: DemoOrm,
) {
  return orm.User.select('id', 'email', 'kind', 'address').create({
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
