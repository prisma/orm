import { expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type { Contract } from './fixtures/generated/contract';

declare const users: Collection<Contract, 'User'>;
declare const projects: Collection<Contract, 'Project'>;
declare const maybeId: number | undefined;
const uniqueUsers = () => users.where({ id: 1 });
const nonUniqueUsers = () => users.where({ name: 'Alice' });

type UniqueFlagOf<C> =
  C extends Collection<Contract, 'User', unknown, infer S> ? S['hasUniqueFilter'] : never;

test('where() sets hasUniqueFilter only for a unique shorthand filter', () => {
  expectTypeOf<UniqueFlagOf<typeof users>>().toEqualTypeOf<false>();
  expectTypeOf<UniqueFlagOf<ReturnType<typeof uniqueUsers>>>().toEqualTypeOf<true>();
  expectTypeOf<UniqueFlagOf<ReturnType<typeof nonUniqueUsers>>>().toEqualTypeOf<false>();
});

test('delete() and update() accept a primary-key filter', () => {
  users.where({ id: 1 }).delete();
  users.where({ id: 1 }).update({ name: 'Alice' });
  users.where({ id: 1 }).select('id', 'email').update({ name: 'Alice' });
  users.where({ id: 1 }).include('posts').delete();
});

test('delete() and update() accept a unique-constraint filter', () => {
  users.where({ email: 'alice@example.com' }).delete();
  users.where({ email: 'alice@example.com' }).update({ name: 'Alice' });
});

test('a unique filter stays unique when narrowed further', () => {
  users.where({ id: 1, name: 'Alice' }).delete();
  users
    .where({ id: 1 })
    .where((u) => u.name.eq('Alice'))
    .delete();
  users
    .where((u) => u.name.eq('Alice'))
    .where({ id: 1 })
    .delete();
});

test('delete() and update() accept a full composite primary key', () => {
  projects.where({ tenantId: 1, id: 2 }).delete();
  projects.where({ tenantId: 1, id: 2 }).update({ name: 'P' });
});

test('delete() and update() reject a non-unique filter', () => {
  // @ts-expect-error delete() needs a unique filter; use deleteAll()
  users.where({ name: 'Alice' }).delete();
  // @ts-expect-error update() needs a unique filter; use updateAll()
  users.where({ name: 'Alice' }).update({ name: 'Bob' });
});

test('delete() and update() reject a partial composite key', () => {
  // @ts-expect-error tenantId alone matches many projects
  projects.where({ tenantId: 1 }).delete();
  // @ts-expect-error tenantId alone matches many projects
  projects.where({ tenantId: 1 }).update({ name: 'P' });
});

test('delete() and update() reject a callback filter', () => {
  // @ts-expect-error a callback filter is not provably unique
  users.where((u) => u.id.eq(1)).delete();
  // @ts-expect-error a callback filter is not provably unique
  users.where((u) => u.id.eq(1)).update({ name: 'Alice' });
});

test('delete() and update() reject a unique key compared to null or undefined', () => {
  // @ts-expect-error `IS NULL` can match many rows
  users.where({ email: null }).delete();
  // @ts-expect-error an undefined value is dropped from the filter
  users.where({ id: maybeId }).delete();
  // @ts-expect-error an undefined value is dropped from the filter
  users.where({ id: maybeId }).update({ name: 'Alice' });
});

test('bulk terminals accept any filter', () => {
  users.where({ name: 'Alice' }).deleteAll();
  users.where({ name: 'Alice' }).deleteAndCount();
  users.where({ name: 'Alice' }).updateAll({ name: 'Bob' });
  users.where({ name: 'Alice' }).updateAndCount({ name: 'Bob' });
  users.where((u) => u.id.eq(1)).deleteAll();
});

test('unknown fields in a unique filter are still rejected', () => {
  // @ts-expect-error `idd` is not a User field
  users.where({ id: 1, idd: 2 });
});
