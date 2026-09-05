import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  type AnyParamRef,
  BinaryExpr,
  CastExpr,
  CodecJsonValueProjection,
  type CodecRef,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import { type CollectionState, emptyState, type IncludeExpr } from '../src/types';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  getTestAggregates,
  isSelectAst,
} from './helpers';
import { unboundTables } from './unbound-tables';

function codecRefFor(table: string, column: string): CodecRef {
  const ref = codecRefForStorageColumn(baseContract.storage, 'public', table, column);
  if (ref === undefined) throw new InternalError(`no codec ref for ${table}.${column}`);
  return ref;
}

function codecForColumn(table: string, column: string): string {
  const columnMeta = (
    unboundTables(baseContract.storage) as Record<
      string,
      { columns: Record<string, { codecId: string; nullable: boolean }> }
    >
  )[table]!.columns[column]!;
  return columnMeta.codecId;
}

function paramCodecs(plan: {
  ast: { collectParamRefs(): AnyParamRef[] };
}): Array<string | undefined> {
  return [...new Set(plan.ast.collectParamRefs())].map((ref) =>
    ref.kind === 'param-ref' ? ref.codec?.codecId : ref.codec.codecId,
  );
}

function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

function expectSubqueryExpr(expr: unknown): asserts expr is SubqueryExpr {
  expect(expr).toBeInstanceOf(SubqueryExpr);
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

describe('compileSelectWithIncludes', () => {
  it('binds unbound state filters at the select-plan boundary', () => {
    const state: CollectionState = {
      ...emptyState(),
      filters: [BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('alice@example.com'))],
    };

    const plan = compileSelect(baseContract, 'public', 'users', state);

    expectSelectAst(plan.ast);
    expect(plan.ast.where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('users', 'email'),
        ParamRef.of('alice@example.com', { codec: { codecId: 'pg/text@1' } }),
      ),
    );
    expect(plan.params).toEqual(['alice@example.com']);
  });

  it('collects params in AST traversal order (includes before top-level)', () => {
    const { collection } = createCollection();
    const state = collection
      .where((user) => user.name.eq('Alice'))
      .include('posts', (posts) => posts.where((post) => post.views.gte(100))).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );
    expect(plan.params).toEqual([100, 'Alice']);
    expect(paramCodecs(plan)).toEqual([
      codecForColumn('posts', 'views'),
      codecForColumn('users', 'name'),
    ]);

    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      bindWhereExpr(
        baseContract,
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
      ),
    );

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.where?.kind).toBe('and');
    expect(childRowsSource.query.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        bindWhereExpr(
          baseContract,
          BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ),
      ]),
    );
  });

  it('carries nulls placement from asc()/desc() through binding to the plan orderBy', () => {
    const { collection } = createCollection();
    const state = collection
      .orderBy((user) => user.name.asc('first'))
      .orderBy((user) => user.id.desc('last'))
      .select('id').state;

    const plan = compileSelect(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.ast.orderBy).toEqual([
      new OrderByItem(ColumnRef.of('users', 'name'), 'asc', 'first'),
      new OrderByItem(ColumnRef.of('users', 'id'), 'desc', 'last'),
    ]);
  });

  it('rejects cursor pagination when orderBy carries nulls placement', () => {
    const { collection } = createCollection();
    const state = collection
      .orderBy((user) => user.name.asc('first'))
      .cursor({ name: 'Alice' })
      .select('id').state;

    expect(() => compileSelect(baseContract, 'public', 'users', state)).toThrow('nulls placement');
  });

  it('rejects cursor pagination when an expression orderBy carries nulls placement', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      orderBy: [OrderByItem.desc(opExpr, 'last'), OrderByItem.asc(ColumnRef.of('posts', 'id'))],
      cursor: { id: 9 },
    };

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).toThrow('nulls placement');
  });

  it('builds lexicographic cursor filters with distinctOn, limit, and offset', () => {
    const { collection } = createCollection();
    const state = collection
      .orderBy((user) => user.name.asc())
      .orderBy((user) => user.id.desc())
      .cursor({ name: 'Alice', id: 7 })
      .distinctOn('email')
      .limit(10)
      .offset(3)
      .select('id').state;

    const plan = compileSelect(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual(['Alice', 'Alice', 7]);
    expect(paramCodecs(plan)).toEqual([
      codecForColumn('users', 'name'),
      codecForColumn('users', 'name'),
      codecForColumn('users', 'id'),
    ]);

    const gtName = bindWhereExpr(
      baseContract,
      BinaryExpr.gt(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    );
    const eqName = bindWhereExpr(
      baseContract,
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    );
    const ltId = bindWhereExpr(
      baseContract,
      BinaryExpr.lt(ColumnRef.of('users', 'id'), LiteralExpr.of(7)),
    );

    expect(plan.ast.where).toEqual(OrExpr.of([gtName, AndExpr.of([eqName, ltId])]));
    expect(plan.ast.distinctOn).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.limit).toBe(10);
    expect(plan.ast.offset).toBe(3);
  });

  it('builds single-column cursor boundaries and rejects incomplete cursors', () => {
    const { collection } = createCollection();
    const state = collection.orderBy((user) => user.id.asc()).cursor({ id: 9 }).state;

    const plan = compileSelect(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual([9]);
    expect(paramCodecs(plan)).toEqual([codecForColumn('users', 'id')]);
    expect(plan.ast.where).toEqual(
      bindWhereExpr(baseContract, BinaryExpr.gt(ColumnRef.of('users', 'id'), LiteralExpr.of(9))),
    );

    const invalidState = {
      ...collection.orderBy((user) => user.id.asc()).state,
      cursor: {},
    };
    expect(() => compileSelect(baseContract, 'public', 'users', invalidState)).toThrow(
      'Missing cursor value for orderBy column "id"',
    );
  });

  it('compiles expression-based orderBy to OrderByItem with the expression', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.desc(opExpr)],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      OrderByItem.asc(ColumnRef.of('posts', 'id')),
      OrderByItem.desc(opExpr),
    ]);

    expect(plan.params).toEqual([[1, 2, 3]]);
    const params = [...new Set(plan.ast.collectParamRefs())];
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ name: 'searchVec', codec: { codecId: 'pg/vector@1' } });
  });

  it('cursor pagination ignores expression-based orders', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.desc(opExpr)],
      cursor: { id: 5 },
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      new OrderByItem(ColumnRef.of('posts', 'id'), 'asc'),
      new OrderByItem(opExpr, 'desc'),
    ]);

    expect(plan.ast.where).toEqual(
      bindWhereExpr(baseContract, BinaryExpr.gt(ColumnRef.of('posts', 'id'), LiteralExpr.of(5))),
    );
  });

  it('compiles extension operation in where() with correct params', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const whereExpr = new BinaryExpr('lt', opExpr, LiteralExpr.of(0.2));

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      filters: [whereExpr],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.params).toEqual([[1, 2, 3]]);
    const params = [...new Set(plan.ast.collectParamRefs())];
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({
      name: 'searchVec',
      codec: { codecId: 'pg/vector@1' },
    });
  });

  it('compiles mixed extension where + extension orderBy with correct param order', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const whereExpr = new BinaryExpr('lt', opExpr, LiteralExpr.of(0.5));

    const orderOpExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([4, 5, 6], { name: 'orderVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      filters: [whereExpr],
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.asc(orderOpExpr)],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      OrderByItem.asc(ColumnRef.of('posts', 'id')),
      OrderByItem.asc(orderOpExpr),
    ]);

    expect(plan.params).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('builds include subqueries with child distinctOn and offset', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .orderBy((post) => post.title.asc())
        .distinctOn('title')
        .offset(1)
        .limit(2),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );
    expectSelectAst(plan.ast);
    expect(plan.ast.joins ?? []).toHaveLength(0);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const aggregateQuery = postsProjection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);

    const childRows = aggregateQuery.from.query;
    expect(childRows.distinctOn).toEqual([ColumnRef.of('posts', 'title')]);
    expect(childRows.offset).toBe(1);
    expect(childRows.limit).toBe(2);
  });

  it('preserves complete codec metadata through row-number dedup', () => {
    const codec: CodecRef = {
      codecId: 'pg/vector@1',
      typeParams: { length: 3 },
      many: true,
    };
    const contract = structuredClone(baseContract);
    Object.assign(contract.storage.namespaces.public.entries.table.posts.columns.embedding, codec);
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts.select('embedding').distinct('embedding'),
    ).state;

    const plan = compileSelectWithIncludes(contract, getTestAggregates(), 'public', 'users', state);
    expectSelectAst(plan.ast);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);
    expectDerivedTableSource(postsProjection.expr.query.from);

    const dedupedRows = postsProjection.expr.query.from.query;
    const embeddingProjection = dedupedRows.projection.find((item) => item.alias === 'embedding');
    expect(embeddingProjection?.codec).toEqual(codec);
  });

  it('preserves nulls placement in the reapplied orderBy of a distinct include', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .distinct('title')
        .orderBy((post) => post.views.desc('first'))
        .limit(2),
    ).state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );
    expectSelectAst(plan.ast);
    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);
    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.orderBy).toEqual([
      new OrderByItem(ColumnRef.of('posts__distinct', 'posts__order_0'), 'desc', 'first'),
    ]);
  });

  // Each scalar reducer lowers to a correlated subquery whose
  // projection is the `json_build_object('value', AGG(...))` envelope.
  // The JSON wrapper lets the value travel through the existing
  // include-payload decoder (which JSON.parse'es the column and pulls
  // `.value` out) — no codec wiring needed on the outer projection.
  describe('correlated scalar reducers', () => {
    function extractScalarCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    /**
     * A reducer's value enters the JSON envelope under the codec the target
     * declares for it, so the expectation names that codec: `count` and `sum`
     * read through `pg/int8number@1`, `avg` through `pg/float8@1` — its
     * lowering casting the mean once — and `min`/`max` keep the column's own
     * codec, `pg/int4@1` here.
     */
    function expectAggregateProjection(
      subquerySelect: SelectAst,
      relationName: string,
      expectedAggregate: AnyExpression,
      resultCodecId: string,
    ): void {
      expect(subquerySelect.projection).toEqual([
        ProjectionItem.of(
          relationName,
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(expectedAggregate, { codecId: resultCodecId }),
            ),
          ]),
        ),
      ]);
    }

    it('emits correlated COUNT(*) for a bare count() include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.count()).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
      );
      // This aggregate has no pagination / orderBy to carry.
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.orderBy).toBeUndefined();
    });

    it('emits correlated COUNT(*) over the where-filtered relation', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gte(100)).count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `orderBy` on a scalar refine is meaningless for an aggregate.
    // Silently drop it at SQL level — matches existing behaviour for
    // other irrelevant clauses (e.g. ignoring select() in scalar context).
    it('silently drops orderBy() applied to a scalar refine', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.orderBy((post) => post.id.asc()).count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
      expect(subquery.orderBy).toBeUndefined();
    });

    // Pagination on a scalar refine composes through to the aggregate
    // scope: `limit(N)` / `offset(M)` shape the row set the aggregate sees.
    it('pagination composes through to the correlated COUNT scope', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .where((post) => post.views.gte(100))
          .offset(5)
          .limit(10)
          .count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.where).toBeUndefined();
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(10);
      expect(innerSelect.offset).toBe(5);
      expect(innerSelect.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `distinct(cols).orderBy(c).limit(N).sum(...)` must aggregate the
    // ordered top-N deduped rows. The ROW_NUMBER dedup wrap strips
    // ordering from its output, so the orderBy is reapplied on the
    // wrapped alias before LIMIT slices the deduped rows.
    it('reapplies orderBy after the ROW_NUMBER dedup wrap', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .distinct('title')
          .orderBy((post) => post.views.desc())
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
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(
        subquery,
        'posts',
        AggregateExpr.sum(ColumnRef.of('posts__scalar', 'views')),
        'pg/int8number@1',
      );
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(2);
      expectDerivedTableSource(innerSelect.from);
      expect(innerSelect.from.alias).toBe('posts__scalar_distinct');
      expect(innerSelect.orderBy).toEqual([
        new OrderByItem(ColumnRef.of('posts__scalar_distinct', 'posts__order_0'), 'desc'),
      ]);
    });

    it('preserves nulls placement in the reapplied orderBy after the dedup wrap', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .distinct('title')
          .orderBy((post) => post.views.desc('last'))
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
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
      expectDerivedTableSource(subquery.from);
      const innerSelect = subquery.from.query;

      expect(innerSelect.orderBy).toEqual([
        new OrderByItem(ColumnRef.of('posts__scalar_distinct', 'posts__order_0'), 'desc', 'last'),
      ]);
    });

    it('emits correlated SUM / AVG / MIN / MAX over the column reference', () => {
      const reducers: ReadonlyArray<['sum' | 'avg' | 'min' | 'max', AnyExpression, string]> = [
        ['sum', AggregateExpr.sum(ColumnRef.of('posts', 'views')), 'pg/int8number@1'],
        [
          'avg',
          CastExpr.as(AggregateExpr.avg(ColumnRef.of('posts', 'views')), 'float8'),
          'pg/float8@1',
        ],
        ['min', AggregateExpr.min(ColumnRef.of('posts', 'views')), 'pg/int4@1'],
        ['max', AggregateExpr.max(ColumnRef.of('posts', 'views')), 'pg/int4@1'],
      ];
      for (const [fn, expected, resultCodecId] of reducers) {
        const { collection } = createCollection();
        const state = collection.include('posts', (posts) => {
          switch (fn) {
            case 'sum':
              return posts.sum('views');
            case 'avg':
              return posts.avg('views');
            case 'min':
              return posts.min('views');
            case 'max':
              return posts.max('views');
          }
        }).state;
        const plan = compileSelectWithIncludes(
          baseContract,
          getTestAggregates(),
          'public',
          'users',
          state,
        );
        const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
        expectAggregateProjection(subquery, 'posts', expected, resultCodecId);
      }
    });

    // Recursive: scalar nested inside a row include emits a nested
    // correlated subquery inside the parent row's child SELECT.
    it('emits a nested correlated subquery for count() inside a row include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.include('comments', (comments) => comments.count()),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const postsSubquery = extractScalarCorrelatedSubquery(plan, 'posts');
      // The posts subquery's FROM is the child-rows derived table; its
      // inner SELECT carries the nested comments correlated subquery as
      // a projection item.
      expectDerivedTableSource(postsSubquery.from);
      const postsRows = postsSubquery.from.query;
      const commentsProjection = postsRows.projection.find((item) => item.alias === 'comments');
      expectSubqueryExpr(commentsProjection?.expr);
      expect(commentsProjection.expr.query.projection).toEqual([
        ProjectionItem.of(
          'comments',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.count(), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ]);
    });
  });

  // combine() packs into a single correlated subquery whose FROM
  // cross-joins per-branch derived tables and whose projection is the
  // `json_build_object`
  // over those branches.
  describe('correlated combine() packing', () => {
    function extractCombineCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    it('packs row + scalar combine into one correlated subquery', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((p) => p.id.desc()).limit(3),
          total: posts.count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      // Outer projection is json_build_object referencing per-branch
      // derived-table aliases.
      expect(subquery.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'recent',
              new JsonDocumentProjection(ColumnRef.of('posts__combine__recent', 'posts')),
            ),
            JsonObjectExpr.entry(
              'total',
              new JsonDocumentProjection(ColumnRef.of('posts__combine__total', 'posts')),
            ),
          ]),
        ),
      ]);

      // FROM <recent_branch>, INNER JOIN <total_branch> ON TRUE.
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__combine__recent');
      const totalJoin = subquery.joins?.[0];
      expect(totalJoin?.joinType).toBe('inner');
      expect(totalJoin?.lateral).toBe(false);
      expect(totalJoin?.on).toEqual(AndExpr.true());
      expectDerivedTableSource(totalJoin?.source);
      expect(totalJoin.source.alias).toBe('posts__combine__total');
    });

    it('packs two scalar branches (count + sum) under correlated', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          a: posts.count(),
          b: posts.sum('views'),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      expectDerivedTableSource(subquery.from);
      const aSelect = subquery.from.query;
      expect(aSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.count(), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ]);
      const bJoin = subquery.joins?.[0];
      expectDerivedTableSource(bJoin?.source);
      const bSelect = bJoin.source.query;
      expect(bSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.sum(ColumnRef.of('posts', 'views')), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ]);
    });

    it('keeps each branch independently scoped under divergent where filters (correlated)', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          popular: posts.where((p) => p.views.gte(200)).count(),
          mediocre: posts.where((p) => p.views.lt(200)).count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      const fkExpr = BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'));
      const popularWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );
      const mediocreWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.lt(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );

      expectDerivedTableSource(subquery.from);
      const popularSelect = subquery.from.query;
      expect(popularSelect.where).toEqual(AndExpr.of([fkExpr, popularWhere]));
      const mediocreJoin = subquery.joins?.[0];
      expectDerivedTableSource(mediocreJoin?.source);
      const mediocreSelect = mediocreJoin.source.query;
      expect(mediocreSelect.where).toEqual(AndExpr.of([fkExpr, mediocreWhere]));
    });
  });
});

describe('M:N include correlated subquery', () => {
  // Codec ref for a real fixture column, matching what the planner attaches to
  // projection items (codecId plus any storage typeParams).
  function codecRef(table: string, column: string): CodecRef {
    const meta = (
      unboundTables(baseContract.storage) as Record<string, { columns: Record<string, CodecRef> }>
    )[table]!.columns[column]!;
    return meta.typeParams !== undefined
      ? { codecId: meta.codecId, typeParams: meta.typeParams }
      : { codecId: meta.codecId };
  }

  // `ref` is the AST table/alias the column is read from; `storageTable`
  // (defaulting to `ref`) is the real fixture table the codec is resolved from
  // — they differ when the planner aliases a self-referential child table.
  function proj(alias: string, ref: string, column: string, storageTable = ref): ProjectionItem {
    return ProjectionItem.of(alias, ColumnRef.of(ref, column), codecRef(storageTable, column));
  }

  it('compiles a single-column M:N include to one correlated subquery through the junction', () => {
    // User.tags -[M:N via user_tags]-> Tag (real emitted fixture):
    //   user_tags.user_id -> users.id (correlation), user_tags.tag_id -> tags.id (join).
    const { collection } = createCollectionFor('User');
    const state = collection.include('tags').state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );

    const tagRows = SelectAst.from(TableSource.named('tags', undefined, 'public'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('user_tags', undefined, 'public'),
          BinaryExpr.eq(ColumnRef.of('user_tags', 'tag_id'), ColumnRef.of('tags', 'id')),
        ),
      ])
      .withProjection([proj('id', 'tags', 'id'), proj('name', 'tags', 'name')])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')));

    const tagsAggregate = SelectAst.from(
      DerivedTableSource.as('tags__rows', tagRows),
    ).withProjection([
      ProjectionItem.of(
        'tags',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('tags__rows', 'id'),
                  codecRefFor('tags', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('tags__rows', 'name'),
                  codecRefFor('tags', 'name'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users', undefined, 'public'))
        .withProjection([
          proj('address', 'users', 'address'),
          proj('email', 'users', 'email'),
          proj('id', 'users', 'id'),
          proj('invited_by_id', 'users', 'invited_by_id'),
          proj('name', 'users', 'name'),
          ProjectionItem.of('tags', SubqueryExpr.of(tagsAggregate)),
        ])
        .withSelectAllIntent({ table: 'users' }),
    );
  });

  it('AND-s across all column pairs for a composite-key M:N junction', () => {
    // Project.related -[M:N via project_links]-> Project (composite key on
    // (tenant_id, id)). The child table is aliased `related__child` because the
    // relation is self-referential. Correlation: project_links.src_* -> projects.*;
    // join: project_links.dst_* -> related__child.*.
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related').state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'projects',
      state,
    );

    const relatedRows = SelectAst.from(TableSource.named('projects', 'related__child', 'public'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('related__child', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('related__child', 'id'),
            ),
          ]),
        ),
      ])
      .withProjection([
        proj('id', 'related__child', 'id', 'projects'),
        proj('name', 'related__child', 'name', 'projects'),
        proj('tenant_id', 'related__child', 'tenant_id', 'projects'),
      ])
      .withWhere(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'src_tenant_id'),
            ColumnRef.of('projects', 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
        ]),
      );

    const relatedAggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', relatedRows),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('projects', undefined, 'public'))
        .withProjection([
          proj('id', 'projects', 'id'),
          proj('name', 'projects', 'name'),
          proj('tenant_id', 'projects', 'tenant_id'),
          ProjectionItem.of('related', SubqueryExpr.of(relatedAggregate)),
        ])
        .withSelectAllIntent({ table: 'projects' }),
    );
  });

  // Control case for the M:N lowering above: an ordinary 1:N FK include
  // (users → posts, joined by posts.user_id = users.id) must still lower to a
  // correlated subquery whose child SELECT has NO junction JOIN and correlates
  // with a plain WHERE on the child's FK column. This pins that the
  // junction-join branch fires only for N:M relations and never leaks into the
  // FK include path.
  it('1:N FK include lowers to a child-FK WHERE with no junction join', () => {
    const { collection } = createCollection();
    const state = collection.include('posts').state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
    );
    expectSelectAst(plan.ast);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSelect = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSelect);
    const childSelect = childRowsSelect.query;

    expect(childSelect.joins ?? []).toHaveLength(0);
    expect(childSelect.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  // M:N + distinct(cols) + a nested non-leaf include exercises
  // `buildDistinctNonLeafChildRowsSelect`, which applies the junction join to
  // the innermost scalar SELECT inside the ROW_NUMBER dedup wrap (the
  // `*__ranked` layer) — never the dedup wrapper or the outer distinct SELECT.
  // Driven off the real fixture's self-referential Project.related M:N: the
  // outer include distinct('name') with a nested .include('related') reaches
  // the distinct-non-leaf lowering. The whole-AST `toEqual` pins the layering:
  // `related__rows` (json_agg) → `related__distinct` (rn = 1 filter) →
  // `related__ranked` (junction join + ROW_NUMBER) → `projects AS related__child`.
  it('lowers M:N + distinct + nested non-leaf to a ranked dedup with the junction join on the ranked layer', () => {
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related', (related) =>
      related.distinct('name').include('related'),
    ).state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'projects',
      state,
    );

    const junctionJoinOnto = (childRef: string): JoinAst =>
      JoinAst.inner(
        TableSource.named('project_links', undefined, 'public'),
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'dst_tenant_id'),
            ColumnRef.of(childRef, 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'dst_id'), ColumnRef.of(childRef, 'id')),
        ]),
      );

    const correlateOnto = (parentRef: string): AndExpr =>
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('project_links', 'src_tenant_id'),
          ColumnRef.of(parentRef, 'tenant_id'),
        ),
        BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of(parentRef, 'id')),
      ]);

    // Innermost scalar SELECT (FROM projects AS related__child) carrying the
    // junction join, correlated WHERE, and the ROW_NUMBER ranking column.
    const ranked = SelectAst.from(TableSource.named('projects', 'related__child', 'public'))
      .withJoins([junctionJoinOnto('related__child')])
      .withProjection([
        proj('id', 'related__child', 'id', 'projects'),
        proj('name', 'related__child', 'name', 'projects'),
        proj('tenant_id', 'related__child', 'tenant_id', 'projects'),
        ProjectionItem.of(
          '__prisma_distinct_rn',
          WindowFuncExpr.rowNumber({
            partitionBy: [ColumnRef.of('related__child', 'name')],
            orderBy: [OrderByItem.asc(ColumnRef.of('related__child', 'name'))],
          }),
        ),
      ])
      .withWhere(correlateOnto('projects'));

    // Nested related aggregate, correlated to the deduped distinct row.
    const nestedRelatedRows = SelectAst.from(TableSource.named('projects', undefined, 'public'))
      .withJoins([junctionJoinOnto('projects')])
      .withProjection([
        proj('id', 'projects', 'id'),
        proj('name', 'projects', 'name'),
        proj('tenant_id', 'projects', 'tenant_id'),
      ])
      .withWhere(correlateOnto('related__distinct'));

    const nestedRelatedAggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', nestedRelatedRows),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    // Dedup filter SELECT: keep rn = 1, forwarding scalar columns and their
    // codecs from the ranked layer.
    const dedupFilter = SelectAst.from(DerivedTableSource.as('related__ranked', ranked))
      .withProjection([
        proj('id', 'related__ranked', 'id', 'projects'),
        proj('name', 'related__ranked', 'name', 'projects'),
        proj('tenant_id', 'related__ranked', 'tenant_id', 'projects'),
      ])
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('related__ranked', '__prisma_distinct_rn'), LiteralExpr.of(1)),
      );

    // Distinct SELECT over the deduped rows: re-attach codecs and the nested
    // related aggregate, correlating it back to these rows.
    const distinct = SelectAst.from(
      DerivedTableSource.as('related__distinct', dedupFilter),
    ).withProjection([
      proj('id', 'related__distinct', 'id', 'projects'),
      proj('name', 'related__distinct', 'name', 'projects'),
      proj('tenant_id', 'related__distinct', 'tenant_id', 'projects'),
      ProjectionItem.of('related', SubqueryExpr.of(nestedRelatedAggregate)),
    ]);

    // Outer aggregate over the deduped rows.
    const aggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', distinct),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
              JsonObjectExpr.entry(
                'related',
                new JsonDocumentProjection(ColumnRef.of('related__rows', 'related')),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('projects', undefined, 'public'))
        .withProjection([
          proj('id', 'projects', 'id'),
          proj('name', 'projects', 'name'),
          proj('tenant_id', 'projects', 'tenant_id'),
          ProjectionItem.of('related', SubqueryExpr.of(aggregate)),
        ])
        .withSelectAllIntent({ table: 'projects' }),
    );
  });

  it('preserves nulls placement in the reapplied orderBy of a distinct non-leaf include', () => {
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related', (related) =>
      related
        .distinct('name')
        .orderBy((r) => r.name.desc('last'))
        .include('related'),
    ).state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'projects',
      state,
    );

    expectSelectAst(plan.ast);
    const relatedProjection = plan.ast.projection.find((item) => item.alias === 'related');
    expectSubqueryExpr(relatedProjection?.expr);
    const rowsSource = relatedProjection.expr.query.from;
    expectDerivedTableSource(rowsSource);
    const distinctSource = rowsSource.query.from;
    expectDerivedTableSource(distinctSource);

    expect(distinctSource.query.orderBy).toEqual([
      new OrderByItem(ColumnRef.of('related__ranked', 'related__order_0'), 'desc', 'last'),
    ]);
  });
});

describe('compileSelect MTI JOINs', () => {
  type AnyContract = {
    storage: {
      namespaces: Record<
        string,
        {
          entries: {
            table: Record<string, { columns: Record<string, { codecId: string }> }>;
          };
        }
      >;
    };
  };
  function codecRefForColumn(
    contract: AnyContract,
    table: string,
    column: string,
  ): { codecId: string } | undefined {
    const tables = unboundTables(contract.storage) as Record<
      string,
      { columns: Record<string, { codecId: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? { codecId } : undefined;
  }
  function projectionFor(
    contract: AnyContract,
    table: string,
    columns: readonly string[],
  ): ProjectionItem[] {
    return columns.map((column) =>
      ProjectionItem.of(
        column,
        ColumnRef.of(table, column),
        codecRefForColumn(contract, table, column),
      ),
    );
  }
  const featuresJoinOn = EqColJoinOn.of(
    ColumnRef.of('tasks', 'id'),
    ColumnRef.of('features', 'id'),
  );

  it('explicit selection controls MTI projections while implicit selection retains them', () => {
    const contract = buildMixedPolyContract();
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
      ProjectionItem.of(
        'features__assignee_id',
        ColumnRef.of('features', 'assignee_id'),
        codecRefForColumn(contract, 'features', 'assignee_id'),
      ),
    ];

    const implicitPlan = compileSelect(contract, 'public', 'tasks', emptyState(), 'Task');
    const omittedMtiPlan = compileSelect(
      contract,
      'public',
      'tasks',
      { ...emptyState(), selectedFields: ['id', 'title'] },
      'Task',
    );
    const selectedMtiPlan = compileSelect(
      contract,
      'public',
      'tasks',
      { ...emptyState(), selectedFields: ['id', 'priority'] },
      'Task',
    );

    expect(implicitPlan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.left(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );

    expectSelectAst(omittedMtiPlan.ast);
    expect(
      omittedMtiPlan.ast.projection
        .map((item) => item.alias)
        .filter((alias) => alias.startsWith('features__')),
    ).toEqual([]);

    expectSelectAst(selectedMtiPlan.ast);
    const selectedAliases = selectedMtiPlan.ast.projection.map((item) => item.alias);
    expect(selectedAliases.filter((alias) => alias.startsWith('features__'))).toEqual([
      'features__priority',
    ]);
    expect(selectedAliases).not.toContain('priority');
  });

  it('variant query INNER JOINs the specific MTI variant table', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Feature' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
      ProjectionItem.of(
        'features__assignee_id',
        ColumnRef.of('features', 'assignee_id'),
        codecRefForColumn(contract, 'features', 'assignee_id'),
      ),
    ];

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.inner(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );
  });

  it('STI-only variant query produces no JOINs', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Bug' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection(tasksBaseProjection)
        .withSelectAllIntent({ table: 'tasks' }),
    );
  });

  it('non-polymorphic model produces no JOINs', () => {
    const plan = compileSelect(baseContract, 'public', 'users', emptyState(), 'User');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users', undefined, 'public'))
        .withProjection(
          projectionFor(baseContract, 'users', ['address', 'email', 'id', 'invited_by_id', 'name']),
        )
        .withSelectAllIntent({ table: 'users' }),
    );
  });
});

describe('compileSelectWithIncludes polymorphic targets', () => {
  function includeFor(
    contract: Contract<SqlStorage>,
    parentModel: string,
    relationName: string,
    nested: CollectionState = emptyState(),
    namespaceId = 'public',
  ): IncludeExpr {
    const relation = resolveIncludeRelation(contract, namespaceId, parentModel, relationName);
    return {
      relationName,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      relatedNamespaceId: relation.relatedNamespaceId,
      localTableName: relation.localTableName,
      targetColumn: relation.targetColumn,
      localColumn: relation.localColumn,
      cardinality: relation.cardinality,
      nested,
      scalar: undefined,
      combine: undefined,
    };
  }

  function stateWithInclude(include: IncludeExpr): CollectionState {
    return { ...emptyState(), includes: [include] };
  }

  function childRowsSelectFor(plan: { ast: unknown }, relationName: string): SelectAst {
    expectSelectAst(plan.ast);
    const projection = plan.ast.projection.find((item) => item.alias === relationName);
    expectSubqueryExpr(projection?.expr);
    const aggregateQuery = projection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);
    return aggregateQuery.from.query;
  }

  function projectionAliases(select: SelectAst): string[] {
    return select.projection.map((item) => item.alias);
  }

  it('STI-target include projects discriminator and variant base-table columns, no joins', () => {
    const contract = buildStiPolyContract();
    const state = stateWithInclude(includeFor(contract, 'Account', 'members'));

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'accounts',
      state,
      'Account',
    );
    const childRows = childRowsSelectFor(plan, 'members');

    expect(childRows.joins ?? []).toHaveLength(0);
    const aliases = projectionAliases(childRows);
    expect(aliases).toContain('kind');
    expect(aliases).toContain('role');
    expect(aliases).toContain('plan');
  });

  it('MTI-target include selection controls variant projections while implicit selection retains them', () => {
    const contract = buildMixedPolyContract();
    const implicitState = stateWithInclude(includeFor(contract, 'Project', 'tasks'));
    const omittedMtiState = stateWithInclude(
      includeFor(contract, 'Project', 'tasks', {
        ...emptyState(),
        selectedFields: ['id', 'title'],
      }),
    );
    const selectedMtiState = stateWithInclude(
      includeFor(contract, 'Project', 'tasks', {
        ...emptyState(),
        selectedFields: ['id', 'priority'],
      }),
    );

    const implicitPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      implicitState,
      'Project',
    );
    const implicitChildRows = childRowsSelectFor(implicitPlan, 'tasks');

    expect(implicitChildRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
    expect(projectionAliases(implicitChildRows)).toEqual([
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
      'features__priority',
      'features__assignee_id',
    ]);

    const omittedMtiPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      omittedMtiState,
      'Project',
    );
    const omittedMtiChildRows = childRowsSelectFor(omittedMtiPlan, 'tasks');
    expect(
      projectionAliases(omittedMtiChildRows).filter((alias) => alias.startsWith('features__')),
    ).toEqual([]);

    const selectedMtiPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      selectedMtiState,
      'Project',
    );
    const selectedMtiAliases = projectionAliases(childRowsSelectFor(selectedMtiPlan, 'tasks'));
    expect(selectedMtiAliases.filter((alias) => alias.startsWith('features__'))).toEqual([
      'features__priority',
    ]);
    expect(selectedMtiAliases).not.toContain('priority');
  });

  it('variant-narrowed MTI-target include inner-joins only the named variant', () => {
    const contract = buildMixedPolyContract();
    const include = includeFor(contract, 'Project', 'tasks', {
      ...emptyState(),
      variantName: 'Feature',
    });
    const state = stateWithInclude(include);

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      state,
      'Project',
    );
    const childRows = childRowsSelectFor(plan, 'tasks');

    expect(childRows.joins).toEqual([
      JoinAst.inner(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
    expect(projectionAliases(childRows)).toContain('features__priority');
  });

  it('self-relation poly include remaps the variant join ON to the child alias', () => {
    const contract = buildMixedPolyContract();
    // `subtasks` is a Task→Task self relation; the child base table is
    // aliased, so the variant join ON must reference the alias rather
    // than the unaliased base table name.
    const state = stateWithInclude(includeFor(contract, 'Task', 'subtasks'));

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      state,
      'Task',
    );
    const childRows = childRowsSelectFor(plan, 'subtasks');

    expect(childRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('subtasks__child', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
  });
});
