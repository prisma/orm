import { ColumnRef, OrderByItem } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import { getTestAggregates } from './helpers';

function orderByItemsIn(node: unknown, found: OrderByItem[] = []): OrderByItem[] {
  if (node instanceof OrderByItem) {
    found.push(node);
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) {
      orderByItemsIn(value, found);
    }
  }
  return found;
}

describe('orderBy null placement', () => {
  it('carries nulls from asc and desc into the plan order items', () => {
    const { collection } = createCollection();
    const state = collection
      .orderBy((user) => user.name.desc({ nulls: 'last' }))
      .orderBy((user) => user.id.asc({ nulls: 'first' }))
      .select('id').state;

    const plan = compileSelect(baseContract, 'public', 'users', state);

    expect(orderByItemsIn(plan.ast)).toEqual([
      OrderByItem.desc(ColumnRef.of('users', 'name'), { nulls: 'last' }),
      OrderByItem.asc(ColumnRef.of('users', 'id'), { nulls: 'first' }),
    ]);
  });

  it('keeps nulls on every order item an ordered include rebuilds', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts.orderBy((post) => post.title.desc({ nulls: 'last' })).limit(2),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(orderByItemsIn(plan.ast)).toEqual([
      OrderByItem.desc(ColumnRef.of('posts', 'title'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__rows', 'posts__order_0'), { nulls: 'last' }),
    ]);
  });

  it('keeps nulls on the order reapplied after a distinct include dedup', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .distinct('title')
        .orderBy((post) => post.views.desc({ nulls: 'last' }))
        .limit(2)
        .sum('views'),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(orderByItemsIn(plan.ast)).toEqual([
      OrderByItem.desc(ColumnRef.of('posts', 'views'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__scalar_distinct', 'posts__order_0'), {
        nulls: 'last',
      }),
    ]);
  });

  it('keeps nulls on the order reapplied to a distinct include of rows', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts.distinct('title').orderBy((post) => post.views.desc({ nulls: 'last' })),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(orderByItemsIn(plan.ast)).toEqual([
      OrderByItem.desc(ColumnRef.of('posts', 'views'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__distinct', 'posts__order_0'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__rows', 'posts__order_0'), { nulls: 'last' }),
    ]);
  });

  it('keeps nulls on the order reapplied to a distinct include that nests another include', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .distinct('title')
        .orderBy((post) => post.views.desc({ nulls: 'last' }))
        .include('comments'),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    expect(orderByItemsIn(plan.ast)).toEqual([
      OrderByItem.desc(ColumnRef.of('posts', 'views'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__ranked', 'posts__order_0'), { nulls: 'last' }),
      OrderByItem.desc(ColumnRef.of('posts__rows', 'posts__order_0'), { nulls: 'last' }),
    ]);
  });

  it('refuses a null placement outside first and last on a scalar field', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.orderBy((post) => post.title.asc({ nulls: 'last, (SELECT 1)' as never })),
    ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
  });

  it('refuses a null placement outside first and last on a relation order', () => {
    const { collection } = createCollectionFor('User');

    expect(() =>
      collection.orderBy((user) => user.posts.count().desc({ nulls: 'middle' as never })),
    ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
    expect(() =>
      collection.orderBy((user) => user.invitedBy.name.asc({ nulls: 'middle' as never })),
    ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
  });
});
