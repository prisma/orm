import { expectTypeOf, test } from 'vitest';
import type { Db } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

type WithCapabilities<Capabilities> = Omit<Contract, 'capabilities'> & {
  readonly capabilities: Capabilities;
};

type PostgresCapabilities = Contract['capabilities'];

type Without<Group extends 'sql' | 'postgres', Flag extends string> = WithCapabilities<
  Omit<PostgresCapabilities, Group> & {
    readonly [G in Group]: Omit<PostgresCapabilities[G], Flag>;
  }
>;

type SqliteLike = WithCapabilities<{
  readonly sql: {
    readonly orderBy: true;
    readonly limit: true;
    readonly lateral: false;
    readonly jsonAgg: true;
    readonly returning: true;
  };
}>;

declare const db: Db<Contract>;
declare const sqliteDb: Db<SqliteLike>;
declare const noLockOf: Db<Without<'sql', 'lockOf'>>;
declare const noNowait: Db<Without<'sql', 'lockNowait'>>;
declare const noSkipLocked: Db<Without<'sql', 'lockSkipLocked'>>;

test('the four methods exist on a Postgres SelectQuery', () => {
  const query = db.public.users.select('id');

  expectTypeOf(query.forUpdate).toBeFunction();
  expectTypeOf(query.forNoKeyUpdate).toBeFunction();
  expectTypeOf(query.forShare).toBeFunction();
  expectTypeOf(query.forKeyShare).toBeFunction();
  expectTypeOf(query.forUpdate().where).toBeFunction();
});

test('the methods are absent on GroupedQuery', () => {
  const grouped = db.public.users.select('id').groupBy('id');

  // @ts-expect-error GroupedQuery has no locking methods
  grouped.forUpdate();
  // @ts-expect-error GroupedQuery has no locking methods
  grouped.forShare();
  // @ts-expect-error GroupedQuery has no locking methods, including after having()
  grouped.having((_f, fns) => fns.gt(fns.count(), 1)).forKeyShare();
});

test('the methods are never on a contract without the flags', () => {
  const query = sqliteDb.public.users.select('id');

  expectTypeOf(query.forUpdate).toBeNever();
  expectTypeOf(query.forNoKeyUpdate).toBeNever();
  expectTypeOf(query.forShare).toBeNever();
  expectTypeOf(query.forKeyShare).toBeNever();
});

test('of accepts only table names and aliases in scope', () => {
  db.public.users.select('id').forUpdate({ of: ['users'] });
  db.public.users
    .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
    .select('title')
    .forUpdate({ of: ['users', 'posts'] });
  db.public.users
    .as('u')
    .select('id')
    .forUpdate({ of: ['u'] });

  // @ts-expect-error posts is not in scope
  db.public.users.select('id').forUpdate({ of: ['posts'] });
  const aliased = db.public.users.as('u').select('id');
  // @ts-expect-error after as('u') only the alias is in scope
  aliased.forUpdate({ of: ['users'] });
  // @ts-expect-error of takes unqualified names
  db.public.users.select('id').forUpdate({ of: ['public.users'] });
});

test('nowait and skipLocked together is a type error', () => {
  db.public.users.select('id').forUpdate({ nowait: true });
  db.public.users.select('id').forUpdate({ skipLocked: true });

  // @ts-expect-error nowait and skipLocked exclude each other
  db.public.users.select('id').forUpdate({ nowait: true, skipLocked: true });
});

test('each option key is absent without its flag', () => {
  noLockOf.public.users.select('id').forUpdate({ nowait: true });
  // @ts-expect-error of needs sql.lockOf
  noLockOf.public.users.select('id').forUpdate({ of: ['users'] });

  noNowait.public.users.select('id').forUpdate({ skipLocked: true });
  // @ts-expect-error nowait needs sql.lockNowait
  noNowait.public.users.select('id').forUpdate({ nowait: true });

  noSkipLocked.public.users.select('id').forUpdate({ nowait: true });
  // @ts-expect-error skipLocked needs sql.lockSkipLocked
  noSkipLocked.public.users.select('id').forUpdate({ skipLocked: true });
});
