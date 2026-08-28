import type { WhereFilter } from '@prisma/orm-postgres/builder/types';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import { db } from '../src/prisma/db';

const userId = '00000000-0000-0000-0000-000000000001';
const users = db.sql.public.user.select('id', 'email', 'createdAt');

function userById(id: string): WhereFilter<Contract, 'public', 'user'> {
  return (fields, operators) => operators.eq(fields.id, id);
}

test('userById returns a reusable SQL builder where filter', () => {
  const filteredUsers = users.where(userById(userId));

  expectTypeOf(filteredUsers).not.toBeNever();
});

test('invalid SQL builder fields fail where the filter is constructed', () => {
  function invalidUserById(id: string): WhereFilter<Contract, 'public', 'user'> {
    return (fields, operators) => {
      // @ts-expect-error — user has no userId column
      return operators.eq(fields.userId, id);
    };
  }

  users.where(invalidUserById(userId));
});
