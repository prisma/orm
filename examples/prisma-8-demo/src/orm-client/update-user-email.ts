import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

export async function ormClientUpdateUserEmail(id: string, email: string, orm: DemoOrm) {
  return orm.User.where({ id: toUserId(id) })
    .select('id', 'email', 'kind')
    .update({ email });
}

function toUserId(value: string): UserId {
  return value as UserId;
}
