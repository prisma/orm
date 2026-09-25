import { ColumnRef, OperationExpr, OrderByItem, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan-aggregate';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { getTestAggregates } from './helpers';

describe('cursor() after an order it cannot key on', () => {
  it('rejects a relation order and names its position', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy([(post) => post.id.asc(), (post) => post.author.name.asc()]);

    expect(() => ordered.cursor({ id: 1 })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 2'),
      }),
    );
  });

  it('rejects a relation count order', () => {
    const { collection } = createCollectionFor('User');
    const ordered = collection.orderBy((user) => user.posts.count().desc());

    expect(() => ordered.cursor({ id: 1 })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 1'),
      }),
    );
  });

  it('rejects an order with null placement', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy((post) => post.title.asc({ nulls: 'last' }));

    expect(() => ordered.cursor({ title: 'a' })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('nulls'),
      }),
    );
  });

  it('rejects an extension-operation order when cursor() is called', () => {
    const { collection } = createCollectionFor('Post');
    const distance = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', template: '{{self}} <=> {{arg0}}' },
    });
    const ordered = collection.orderBy([(post) => post.id.asc(), () => OrderByItem.asc(distance)]);

    expect(() => ordered.cursor({ id: 1 })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 2'),
      }),
    );
  });

  it('keeps accepting plain column orders', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.orderBy((post) => post.title.desc()).cursor({ title: 'a' }),
    ).not.toThrow();
  });

  it('refuses to build a keyset when a relation order follows the cursor', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy((post) => post.id.asc())
      .cursor({ id: 1 })
      .orderBy((post) => post.author.name.asc()).state;

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });

  it('refuses to build a keyset when an order with null placement follows the cursor', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy((post) => post.id.asc())
      .cursor({ id: 1 })
      .orderBy((post) => post.title.asc({ nulls: 'first' })).state;

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });
});

describe('distinctOn() and the orders it needs', () => {
  it('rejects a relation order among the leading distinctOn positions and names it', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy([
      (post) => post.author.name.asc(),
      (post) => post.title.asc(),
    ]);

    expect(() => ordered.distinctOn('title')).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 1'),
      }),
    );
  });

  it('accepts a relation order after the distinctOn columns', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy([(post) => post.title.asc(), (post) => post.author.name.asc()])
      .distinctOn('title').state;

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).not.toThrow();
  });

  it('accepts column orders with null placement', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.orderBy((post) => post.title.asc({ nulls: 'last' })).distinctOn('title'),
    ).not.toThrow();
  });

  describe('when a relation order added after distinctOn() lands in a leading position', () => {
    function postsState() {
      const { collection } = createCollectionFor('Post');
      return collection
        .orderBy((post) => post.title.asc())
        .distinctOn('title', 'views')
        .orderBy((post) => post.author.name.asc()).state;
    }

    const refusal = expect.objectContaining({
      code: 'ORM.ARGUMENT_INVALID',
      message: expect.stringContaining('orderBy item 2'),
    });
    const sum = { totalViews: { kind: 'aggregate' as const, fn: 'sum', column: 'views' } };

    it('refuses to build the select', () => {
      expect(() => compileSelect(baseContract, 'public', 'posts', postsState())).toThrow(refusal);
    });

    it('refuses to build the aggregate', () => {
      expect(() =>
        compileAggregate(baseContract, getTestAggregates(), 'public', 'posts', postsState(), sum),
      ).toThrow(refusal);
    });

    it('refuses to build the grouped aggregate', () => {
      expect(() =>
        compileGroupedAggregate(
          baseContract,
          getTestAggregates(),
          'public',
          'posts',
          postsState(),
          ['user_id'],
          sum,
          undefined,
        ),
      ).toThrow(refusal);
    });

    it('refuses to build an include of rows', () => {
      const { collection } = createCollectionFor('User');
      const state = collection.include('posts', (posts) =>
        posts
          .orderBy((post) => post.title.asc())
          .distinctOn('title', 'views')
          .orderBy((post) => post.comments.count().desc()),
      ).state;

      expect(() =>
        compileSelectWithIncludes(baseContract, getTestAggregates(), 'public', 'users', state),
      ).toThrow(refusal);
    });

    it('refuses to build a scalar include', () => {
      const { collection } = createCollectionFor('User');
      const state = collection.include('posts', (posts) =>
        posts
          .orderBy((post) => post.title.asc())
          .distinctOn('title', 'views')
          .orderBy((post) => post.comments.count().desc())
          .sum('views'),
      ).state;

      expect(() =>
        compileSelectWithIncludes(baseContract, getTestAggregates(), 'public', 'users', state),
      ).toThrow(refusal);
    });
  });
});
