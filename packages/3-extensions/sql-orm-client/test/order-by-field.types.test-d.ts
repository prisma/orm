import type { OrderByItem } from '@internal/sql-relational-core/ast';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { Ordered } from '../src/collection-types';
import { orderByField } from '../src/scopes';
import type { Orderable, OrderableFieldNames } from '../src/types';
import { createChainingOrm, type PostCollection } from './collection-chaining-fixture';
import type { TestContract } from './helpers';

declare const input: { orderBy: string; direction: string | undefined };

const { db, plain } = createChainingOrm();

class OrderedPostCollection extends Collection<TestContract, 'Post'> {
  ordered(name: string) {
    return this.orderBy(orderByField(this, name, 'desc', ['title', 'views']));
  }
}

describe('OrderableFieldNames', () => {
  test('names the fields whose codec can be ordered', () => {
    expectTypeOf<OrderableFieldNames<TestContract, 'Post'>>().toEqualTypeOf<
      'id' | 'title' | 'userId' | 'views'
    >();
  });
});

describe('orderByField', () => {
  test('returns an orderBy selector over the allowed fields', () => {
    const selector = orderByField(db.Post, input.orderBy, input.direction, ['title', 'views']);
    expectTypeOf(selector).toEqualTypeOf<
      (row: { readonly title: Orderable; readonly views: Orderable }) => OrderByItem
    >();
  });

  test('requires a non-empty allowed list', () => {
    // @ts-expect-error the allowed list is required
    orderByField(db.Post, input.orderBy, input.direction);
    // @ts-expect-error the allowed list names at least one field
    orderByField(db.Post, input.orderBy, input.direction, []);
  });

  test('takes the direction from a request as a string', () => {
    expectTypeOf(orderByField(db.Post, input.orderBy, input.direction, ['title'])).toEqualTypeOf<
      (row: { readonly title: Orderable }) => OrderByItem
    >();
  });

  test('records the order, so cursor is allowed', () => {
    const posts = db.Post.orderBy(
      orderByField(db.Post, input.orderBy, input.direction, ['title', 'views']),
    );
    expectTypeOf(posts).toEqualTypeOf<Ordered<PostCollection>>();
    expectTypeOf(posts.cursor({ id: 1 })).toEqualTypeOf<Ordered<PostCollection>>();
  });

  test('fits a plain root collection', () => {
    expectTypeOf(
      plain.Post.orderBy(orderByField(plain.Post, input.orderBy, 'asc', ['title'])).cursor({
        title: 'x',
      }),
    ).not.toBeAny();
  });

  test('fits a chained collection, an include refinement and this', () => {
    expectTypeOf(
      db.Post.where({ title: 'x' }).orderBy(orderByField(db.Post, input.orderBy, 'asc', ['title'])),
    ).not.toBeAny();
    db.User.include('posts', (posts) =>
      posts.orderBy(orderByField(posts, input.orderBy, 'asc', ['title'])),
    );
    expectTypeOf<ReturnType<OrderedPostCollection['ordered']>>().toEqualTypeOf<
      Ordered<OrderedPostCollection>
    >();
  });

  test('fits another model that has the allowed fields', () => {
    plain.Article.orderBy(orderByField(db.Post, input.orderBy, 'asc', ['title']));
    // @ts-expect-error Tag has no title
    plain.Tag.orderBy(orderByField(db.Post, input.orderBy, 'asc', ['title']));
  });

  test('refuses a field that cannot be ordered in the allowed list', () => {
    // @ts-expect-error Post has no field nope
    orderByField(db.Post, input.orderBy, 'asc', ['nope']);
    // @ts-expect-error the codec of embedding has no order trait
    orderByField(db.Post, input.orderBy, 'asc', ['embedding']);
    // @ts-expect-error author is a relation
    orderByField(db.Post, input.orderBy, 'asc', ['author']);
  });
});
