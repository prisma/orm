import type { RelationPredicate, ShorthandWhereFilter } from '@prisma/orm-postgres/orm-client';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/prisma/contract';
import { db as demoDb } from '../src/prisma/db';

const userId = '00000000-0000-0000-0000-000000000001';

function userById(id: string): ShorthandWhereFilter<Contract, 'public', 'User'> {
  return { id };
}

function userByIdPredicate(id: string): RelationPredicate<Contract, 'public', 'User'> {
  return (user) => user.id.eq(id);
}

test('shorthand and predicate helpers return reusable User where filters', () => {
  const db = demoDb.orm.public;
  const shorthandUsers = db.User.where(userById(userId));
  const predicateUsers = db.User.where(userByIdPredicate(userId));

  expectTypeOf(shorthandUsers).not.toBeNever();
  expectTypeOf(predicateUsers).not.toBeNever();
});

test('invalid shorthand fields fail where the filter is constructed', () => {
  function invalidUserById(id: string): ShorthandWhereFilter<Contract, 'public', 'User'> {
    return {
      // @ts-expect-error — User has no userId field
      userId: id,
    };
  }

  const db = demoDb.orm.public;
  db.User.where(invalidUserById(userId));
});

test('invalid predicate fields fail where the filter is constructed', () => {
  function invalidUserByIdPredicate(id: string): RelationPredicate<Contract, 'public', 'User'> {
    // @ts-expect-error — User has no userId field
    return (user) => user.userId.eq(id);
  }

  const db = demoDb.orm.public;
  db.User.where(invalidUserByIdPredicate(userId));
});
