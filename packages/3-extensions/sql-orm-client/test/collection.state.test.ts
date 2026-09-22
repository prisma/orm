import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  InsertAst,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  type ToWhereExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import {
  baseContract,
  createCollection,
  createCollectionFor,
  createReturningCollectionFor,
  createReturningCollectionWithoutCapabilities,
  createReturningCollectionWithoutDefaultInInsert,
} from './collection-fixtures';
import type { MockExecution, MockRuntime } from './helpers';

function insertAstOf(execution: MockExecution): InsertAst {
  const ast = (execution.plan as { ast: unknown }).ast;
  expect(ast).toBeInstanceOf(InsertAst);
  return ast as InsertAst;
}

function lastInsertAst(runtime: MockRuntime): InsertAst {
  const execution = runtime.executions[runtime.executions.length - 1];
  if (!execution) throw new Error('runtime recorded no executions');
  return insertAstOf(execution);
}

describe('Collection', () => {
  describe('chain methods', () => {
    it('where() appends rich filters and stays immutable', () => {
      const { collection } = createCollection();

      const filtered = collection.where((user) => user.name.eq('Alice'));
      expect(filtered.state.filters).toEqual([
        bindWhereExpr(
          baseContract,
          BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        ),
      ]);
      expect(collection.state.filters).toEqual([]);

      const chained = filtered.where((user) => user.email.neq('old@example.com'));
      expect(chained.state.filters).toEqual([
        bindWhereExpr(
          baseContract,
          BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        ),
        bindWhereExpr(
          baseContract,
          BinaryExpr.neq(ColumnRef.of('users', 'email'), LiteralExpr.of('old@example.com')),
        ),
      ]);
    });

    it('where() accepts ToWhereExpr payloads and bare ParamRef expressions', () => {
      const { collection } = createCollection();

      const filtered = collection.where(
        (_user) =>
          ({
            toWhereExpr: () =>
              BinaryExpr.eq(
                ColumnRef.of('users', 'name'),
                ParamRef.of('Alice', { name: 'name', codec: { codecId: 'pg/text@1' } }),
              ),
          }) satisfies ToWhereExpr,
      );

      expect(filtered.state.filters).toEqual([
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codec: { codecId: 'pg/text@1' } }),
        ),
      ]);

      const bare = collection.where((_user) =>
        BinaryExpr.eq(
          ColumnRef.of('users', 'id'),
          ParamRef.of(7, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      );
      expect(bare.state.filters).toEqual([
        BinaryExpr.eq(
          ColumnRef.of('users', 'id'),
          ParamRef.of(7, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      ]);
    });

    it('where() accepts shorthand filters, handles null and undefined, and treats {} as identity', () => {
      const { collection } = createCollection();

      const filtered = collection.where({
        name: 'Alice',
        email: null,
        id: undefined!,
      });

      expect(filtered.state.filters).toEqual([
        bindWhereExpr(
          baseContract,
          AndExpr.of([
            BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
            NullCheckExpr.isNull(ColumnRef.of('users', 'email')),
          ]),
        ),
      ]);

      expect(collection.where({})).toBe(collection);
    });

    it('select() replaces the prior selection set', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const selected = postCollection.select('title');
      const reselected = selected.select('userId');

      expect(selected.state.selectedFields).toEqual(['title']);
      expect(reselected.state.selectedFields).toEqual(['user_id']);
    });

    it('orderBy() appends later directives', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const ordered = postCollection.orderBy((post) => post.userId.asc());
      const reordered = ordered.orderBy((post) => post.id.desc());

      expect(ordered.state.orderBy).toEqual([OrderByItem.asc(ColumnRef.of('posts', 'user_id'))]);
      expect(reordered.state.orderBy).toEqual([
        OrderByItem.asc(ColumnRef.of('posts', 'user_id')),
        OrderByItem.desc(ColumnRef.of('posts', 'id')),
      ]);
    });

    it('orderBy() accepts expression-based orders', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const opExpr = new OperationExpr({
        method: 'cosineDistance',
        self: ColumnRef.of('posts', 'embedding'),
        args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
        returns: { codecId: 'builtin/float8', nullable: false },
        lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
      });

      const ordered = postCollection.orderBy(() => OrderByItem.asc(opExpr));
      expect(ordered.state.orderBy).toEqual([OrderByItem.asc(opExpr)]);
    });

    it('orderBy() mixes column-based and expression-based orders', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const opExpr = new OperationExpr({
        method: 'cosineDistance',
        self: ColumnRef.of('posts', 'embedding'),
        args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
        returns: { codecId: 'builtin/float8', nullable: false },
        lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
      });

      const ordered = postCollection
        .orderBy((p) => p.id.asc())
        .orderBy(() => OrderByItem.desc(opExpr));

      expect(ordered.state.orderBy).toEqual([
        OrderByItem.asc(ColumnRef.of('posts', 'id')),
        OrderByItem.desc(opExpr),
      ]);
    });

    it('tracks ordering, paging, selection, distinct, and cursor state', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      const ordered = postCollection.orderBy((post) => post.userId.asc());
      expect(ordered.state.orderBy).toEqual([OrderByItem.asc(ColumnRef.of('posts', 'user_id'))]);

      const paged = ordered.cursor({ userId: 7 }).limit(10).offset(5);
      expect(paged.state.cursor).toEqual({ user_id: 7 });
      expect(paged.state.limit).toBe(10);
      expect(paged.state.offset).toBe(5);

      expect(postCollection.distinct('userId').state.distinct).toEqual(['user_id']);
      expect(ordered.distinctOn('userId').state.distinctOn).toEqual(['user_id']);
      expect(postCollection.select('userId').state.selectedFields).toEqual(['user_id']);
    });

    it('captures include metadata, scalar selectors, and combine branches', () => {
      const { collection } = createCollection();

      const withPosts = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gt(100)).limit(5),
      );
      expect(withPosts.state.includes[0]).toMatchObject({
        relationName: 'posts',
        relatedModelName: 'Post',
        relatedTableName: 'posts',
        targetColumn: 'user_id',
        cardinality: '1:N',
      });
      expect(withPosts.state.includes[0]?.nested.filters).toEqual([
        bindWhereExpr(
          baseContract,
          BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ),
      ]);
      expect(withPosts.state.includes[0]?.nested.limit).toBe(5);
      expect(collection.state.includes).toEqual([]);

      const withPostCount = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gt(100)).count(),
      );
      expect(withPostCount.state.includes[0]?.scalar).toMatchObject({
        kind: 'includeScalar',
        fn: 'count',
      });
      expect(withPostCount.state.includes[0]?.scalar?.state.filters).toEqual([
        bindWhereExpr(
          baseContract,
          BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ),
      ]);

      const combined = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((post) => post.id.desc()).limit(1),
          totalCount: posts.count(),
        }),
      );
      const recentBranch = combined.state.includes[0]?.combine?.['recent'];
      expect(recentBranch?.kind).toBe('rows');
      if (recentBranch?.kind === 'rows') {
        expect(recentBranch.state.limit).toBe(1);
      }

      const totalCountBranch = combined.state.includes[0]?.combine?.['totalCount'];
      expect(totalCountBranch?.kind).toBe('scalar');
      if (totalCountBranch?.kind === 'scalar') {
        expect(totalCountBranch.selector.fn).toBe('count');
      }
    });

    it('captures to-one metadata and rejects unsupported to-one refinements', () => {
      const { collection: postCollection } = createCollectionFor('Post', baseContract);

      expect(postCollection.include('author').state.includes[0]).toMatchObject({
        relationName: 'author',
        relatedModelName: 'User',
        relatedTableName: 'users',
        targetColumn: 'id',
        localColumn: 'user_id',
        cardinality: 'N:1',
      });

      expect(() =>
        postCollection.include(
          'author',
          (author) => (author as unknown as { count: () => unknown }).count() as never,
        ),
      ).toThrow(/scalar aggregations are only supported for to-many relations/);

      expect(() =>
        postCollection.include(
          'author',
          (author) =>
            (
              author as unknown as {
                combine: (spec: Record<string, unknown>) => unknown;
                count: () => unknown;
              }
            ).combine({
              count: (author as unknown as { count: () => unknown }).count(),
            }) as never,
        ),
      ).toThrow(/combine\(\) is only supported for to-many relations/);
    });

    it('rejects invalid include refinement returns and invalid branches', () => {
      const { collection } = createCollection();

      expect(() => collection.include('posts', () => ({ invalid: true }) as never)).toThrow(
        /refinement must return a collection/,
      );
      expect(() =>
        collection.include('posts', (posts) =>
          posts.combine({
            invalid: { nope: true } as never,
          }),
        ),
      ).toThrow(/branch "invalid" is invalid/);
      expect(() => collection.count()).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
      expect(() => collection.sum('id' as never)).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
      expect(() => collection.combine({} as never)).toThrow(
        /only available inside include\(\) refinement callbacks/,
      );
    });

    it('keeps cursor() as identity when mapped cursor values are empty', () => {
      const { collection } = createCollection();
      const ordered = collection.orderBy((user) => user.id.asc());
      expect(ordered.cursor({ id: undefined } as never)).toBe(ordered);
    });
  });

  describe('operation guards', () => {
    it('aggregate() validates selector shape and handles empty runtime rows', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextResults([[]]);

      await expect(collection.aggregate(() => ({}))).rejects.toThrow(
        /requires at least one aggregation selector/,
      );
      await expect(
        collection.aggregate(() => ({ invalid: { kind: 'nope' } as never })),
      ).rejects.toThrow(/selector "invalid" is invalid/);

      await expect(
        collection.aggregate((aggregate) => ({
          count: aggregate.count(),
        })),
      ).resolves.toEqual({ count: 0 });
    });

    it('createAndCount() returns 0 for empty payloads', async () => {
      const { collection } = createCollection();
      await expect(collection.createAndCount([])).resolves.toBe(0);
    });

    it('create() nested mutation throws when reload by primary key returns no row', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
        [{ id: 10, title: 'Post', user_id: 1, views: 1 }],
        [],
      ]);

      await expect(
        collection.create({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
            posts.create([
              {
                id: 10,
                title: 'Post',
                views: 1,
              },
            ]),
        } as never),
      ).rejects.toThrow(/did not return a row/);
    }, 500);

    it('createAll() uses split insert when defaultInInsert is absent', async () => {
      const { collection, runtime } = createReturningCollectionWithoutDefaultInInsert('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
        [{ id: 2, name: 'Bob', email: 'bob@example.com', invited_by_id: 1, address: null }],
      ]);

      const rows = await collection
        .createAll([
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
        ])
        .toArray();

      expect(rows).toHaveLength(2);
      expect(runtime.executions).toHaveLength(2);
    });

    it('createAndCount() uses split insert when defaultInInsert is absent', async () => {
      const { collection, runtime } = createReturningCollectionWithoutDefaultInInsert('User');
      runtime.setNextResults([[], []]);
      runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 1 }]);

      const count = await collection.createAndCount([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
      ]);

      expect(count).toBe(2);
      expect(runtime.executions).toHaveLength(2);
    });

    it('createAndCount() returns the database count, not the input length', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextStats([{ affectedRows: 2 }]);

      const count = await collection.createAndCount([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Carol', email: 'carol@example.com' },
      ]);

      expect(count).toBe(2);
      expect(runtime.executions).toHaveLength(1);
    });

    it('createAndCount() sums the database counts across split statements', async () => {
      const { collection, runtime } = createReturningCollectionWithoutDefaultInInsert('User');
      runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 1 }]);

      const count = await collection.createAndCount([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Carol', email: 'carol@example.com', invitedById: 1 },
      ]);

      expect(count).toBe(2);
      expect(runtime.executions).toHaveLength(2);
    });

    it('createAll() carries a targetless skip clause on the single statement', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
      ]);

      await collection
        .createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], { onConflict: 'skip' })
        .toArray();

      const ast = lastInsertAst(runtime);
      expect(ast.onConflict?.columns).toEqual([]);
      expect(ast.onConflict?.action.kind).toBe('do-nothing');
    });

    it('createAll() maps conflictOn fields to their storage columns', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
      ]);

      await collection
        .createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
          conflictOn: ['invitedById'],
        })
        .toArray();

      const ast = lastInsertAst(runtime);
      expect(ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'invited_by_id')]);
    });

    it('createAll() treats an empty conflictOn as untargeted', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
      ]);

      await collection
        .createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
          conflictOn: [],
        })
        .toArray();

      expect(lastInsertAst(runtime).onConflict?.columns).toEqual([]);
    });

    it('createAll() keeps the configure callback working in second position', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');
      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
      ]);

      await collection
        .createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], () => {})
        .toArray();

      expect(lastInsertAst(runtime).onConflict).toBeUndefined();
    });

    it('createAndCount() carries the skip clause and returns the database count', async () => {
      const { collection, runtime } = createCollection();
      runtime.setNextStats([{ affectedRows: 1 }]);

      const count = await collection.createAndCount(
        [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
        { onConflict: 'skip' },
      );

      expect(count).toBe(1);
      expect(lastInsertAst(runtime).onConflict?.action.kind).toBe('do-nothing');
    });

    it('createAndCount() puts the skip clause on every split statement', async () => {
      const { collection, runtime } = createReturningCollectionWithoutDefaultInInsert('User');
      runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 1 }]);

      const count = await collection.createAndCount(
        [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Carol', email: 'carol@example.com', invitedById: 1 },
        ],
        { onConflict: 'skip' },
      );

      expect(count).toBe(2);
      expect(runtime.executions).toHaveLength(2);
      for (const execution of runtime.executions) {
        expect(insertAstOf(execution).onConflict?.action.kind).toBe('do-nothing');
      }
    });

    it('createAll() refuses the skip option without the insertOnConflictSkip capability', async () => {
      const { collection, runtime } = createReturningCollectionWithoutCapabilities('User', [
        'insertOnConflictSkip',
      ]);

      expect(() =>
        collection.createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
          conflictOn: ['email'],
        }),
      ).toThrow(expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }));
      expect(runtime.executions).toHaveLength(0);
    });

    it('createAndCount() refuses the skip option without the insertOnConflictSkip capability', async () => {
      const { collection, runtime } = createReturningCollectionWithoutCapabilities('User', [
        'insertOnConflictSkip',
      ]);

      await expect(
        collection.createAndCount([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
        }),
      ).rejects.toThrow(/insertOnConflictSkip/);
      expect(runtime.executions).toHaveLength(0);
    });

    it('createAll() refuses an untargeted skip without insertOnConflictWithoutTarget but allows a targeted one', async () => {
      const { collection, runtime } = createReturningCollectionWithoutCapabilities('User', [
        'insertOnConflictWithoutTarget',
      ]);

      expect(() =>
        collection.createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
        }),
      ).toThrow(/insertOnConflictWithoutTarget/);
      expect(runtime.executions).toHaveLength(0);

      runtime.setNextResults([
        [{ id: 1, name: 'Alice', email: 'alice@example.com', invited_by_id: null, address: null }],
      ]);
      await collection
        .createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
          conflictOn: ['email'],
        })
        .toArray();

      expect(lastInsertAst(runtime).onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    });

    it('createAll() refuses a conflictOn field that is not a scalar field of the model', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');

      expect(() =>
        collection.createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'skip',
          conflictOn: ['posts' as never],
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: expect.stringContaining('posts'),
        }),
      );
      expect(runtime.executions).toHaveLength(0);
    });

    it('createAll() refuses an unknown onConflict value', async () => {
      const { collection, runtime } = createReturningCollectionFor('User');

      expect(() =>
        collection.createAll([{ id: 1, name: 'Alice', email: 'alice@example.com' }], {
          onConflict: 'merge' as never,
        }),
      ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
      expect(runtime.executions).toHaveLength(0);
    });

    it('update() returns null when nested or scalar updates return no rows', async () => {
      const { collection: nestedCollection, runtime: nestedRuntime } =
        createReturningCollectionFor('User');
      nestedRuntime.setNextResults([[]]);

      const nestedUpdated = await nestedCollection.where({ id: 1 }).update({
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 10 }),
      } as never);
      expect(nestedUpdated).toBeNull();

      const { collection: updateCollection, runtime: updateRuntime } =
        createReturningCollectionFor('User');
      updateRuntime.setNextResults([[]]);

      const updated = await updateCollection.where({ id: 1 }).update({ name: 'Updated' });
      expect(updated).toBeNull();
    });
  });
});
