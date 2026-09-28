import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime, type TestContract } from './helpers';

const runtime = createMockRuntime();
const context = {} as ExecutionContext<TestContract>;
const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
declare const narrowToOne: boolean;

test('a filtered collection is assignable to an unfiltered one', () => {
  const filtered: typeof users = users.where({ id: 1 });
  expectTypeOf(filtered).not.toBeAny();
});

test('a paged collection is assignable to an unpaged one', () => {
  const paged: typeof users = users.limit(1);
  expectTypeOf(paged).not.toBeAny();
});

test('a conditionally filtered collection still exposes include', () => {
  const maybeFiltered = narrowToOne ? users.where({ id: 1 }) : users;
  const withPosts = maybeFiltered.include('posts', (posts) => posts.select('title'));
  expectTypeOf(withPosts).not.toBeAny();
  expectTypeOf(maybeFiltered).toEqualTypeOf(users);
});
