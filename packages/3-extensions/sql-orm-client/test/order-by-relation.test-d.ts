import type { OrderByItem, OrderByNulls } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { ModelAccessor } from '../src/types';
import { createMockRuntime, type TestContract } from './helpers';

const runtime = createMockRuntime();
const context = {} as ExecutionContext<TestContract>;

const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });

type UserAccessor = ModelAccessor<TestContract, 'User', 'public'>;
type PostAccessor = ModelAccessor<TestContract, 'Post', 'public'>;
type OrderOptions = { readonly nulls?: OrderByNulls } | undefined;

describe('ordering through a to-one relation', () => {
  test('an N:1 relation exposes the related scalar columns as ordering expressions', () => {
    expectTypeOf<keyof PostAccessor['author']['name']>().toEqualTypeOf<'asc' | 'desc'>();
    expectTypeOf<PostAccessor['author']['name']['asc']>().returns.toEqualTypeOf<OrderByItem>();
    expectTypeOf<PostAccessor['author']['name']['desc']>()
      .parameter(0)
      .toEqualTypeOf<OrderOptions>();
    expectTypeOf<UserAccessor['invitedBy']>().toHaveProperty('email');
  });

  test('a 1:1 relation exposes the related scalar columns as ordering expressions', () => {
    expectTypeOf<UserAccessor['profile']>().toHaveProperty('bio');
    expectTypeOf<UserAccessor['profile']['bio']['asc']>().returns.toEqualTypeOf<OrderByItem>();
  });

  test('keeps the relation filters', () => {
    expectTypeOf<PostAccessor['author']>().toHaveProperty('some');
    expectTypeOf<PostAccessor['author']>().toHaveProperty('every');
    expectTypeOf<PostAccessor['author']>().toHaveProperty('none');
  });

  test('does not expose count or the related model relations', () => {
    expectTypeOf<PostAccessor['author']>().not.toHaveProperty('count');
    expectTypeOf<PostAccessor['author']>().not.toHaveProperty('posts');
    expectTypeOf<PostAccessor['author']>().not.toHaveProperty('invitedBy');
  });

  test('does not expose a related field whose codec is not orderable', () => {
    expectTypeOf<PostAccessor['author']>().not.toHaveProperty('address');
  });

  test('orders a collection by a related column, and cursor still typechecks after it', () => {
    posts.orderBy((p) => p.author.name.asc());
    posts.orderBy([(p) => p.author.name.desc({ nulls: 'last' }), (p) => p.id.asc()]);
    posts.orderBy((p) => p.author.name.asc()).cursor({ id: 1 });
    // @ts-expect-error a related column carries only asc and desc
    posts.orderBy((p) => p.author.name.eq('Alice'));
  });
});

describe('ordering through a to-many relation', () => {
  test('a 1:N relation exposes count and no related fields', () => {
    expectTypeOf<UserAccessor['posts']>().toHaveProperty('count');
    expectTypeOf<UserAccessor['posts']>().not.toHaveProperty('title');
    expectTypeOf<
      ReturnType<UserAccessor['posts']['count']>['desc']
    >().returns.toEqualTypeOf<OrderByItem>();
  });

  test('an N:M relation exposes count and no related fields', () => {
    expectTypeOf<UserAccessor['tags']>().toHaveProperty('count');
    expectTypeOf<UserAccessor['tags']>().not.toHaveProperty('name');
  });

  test('types the count predicate against the related model', () => {
    users.orderBy((u) => u.posts.count().desc());
    users.orderBy((u) => u.posts.count((p) => p.views.gt(10)).asc({ nulls: 'first' }));
    users.orderBy((u) => u.tags.count((t) => t.name.eq('orm')).desc());
    // @ts-expect-error email is a User field, not a Post field
    users.orderBy((u) => u.posts.count((p) => p.email.eq('a@example.com')).desc());
  });
});

describe('null placement', () => {
  test('asc and desc on a scalar field accept a nulls option', () => {
    expectTypeOf<PostAccessor['title']['asc']>().parameter(0).toEqualTypeOf<OrderOptions>();
    posts.orderBy((p) => p.title.asc({ nulls: 'last' }));
    posts.orderBy((p) => p.title.desc({ nulls: 'first' }));
    // @ts-expect-error nulls is first or last
    posts.orderBy((p) => p.title.asc({ nulls: 'middle' }));
  });
});

describe('where keeps the relation filters on both cardinalities', () => {
  test('some, every and none', () => {
    users.where((u) => u.posts.some((p) => p.views.gt(10)));
    users.where((u) => u.tags.every((t) => t.name.eq('orm')));
    users.where((u) => u.invitedBy.none());
    posts.where((p) => p.author.some((a) => a.name.eq('Alice')));
  });
});
