import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime, type TestContract } from './helpers';

const runtime = createMockRuntime();
const context = {} as ExecutionContext<TestContract>;
const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
declare const narrowToOne: boolean;

test('a conditionally filtered collection collapses to the filtered type and exposes include', () => {
  const maybeFiltered = narrowToOne ? users.where({ id: 1 }) : users;
  expectTypeOf(maybeFiltered).toEqualTypeOf(users.where({ id: 1 }));
  const withPosts = maybeFiltered.include('posts', (posts) => posts.select('title'));
  expectTypeOf(withPosts).not.toBeAny();
});
