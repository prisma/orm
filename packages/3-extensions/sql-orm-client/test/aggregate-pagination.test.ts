import {
  AggregateExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  LiteralExpr,
  OrderByItem,
  ProjectionItem,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { isSelectAst, type MockRuntime } from './helpers';

function selectAstOf(runtime: MockRuntime) {
  const ast = runtime.executions[0]?.plan.ast;
  if (!isSelectAst(ast)) {
    throw new Error('Expected the aggregate execution plan to be a select SQL query plan');
  }
  return ast;
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

const numericField = 'views' as never;

// Pagination composes through to the aggregate input on a nested scalar
// refine — `include('posts', (p) => p.skip(5).take(10).count())` aggregates
// over a derived table carrying the LIMIT/OFFSET. The root-level `aggregate()`
// terminal now does the same: `take`/`skip` wrap the source in a derived
// table aliased back to `tableName` (the same trick the plain-select path
// uses for `distinct(cols)`) so the outer aggregate reduces over exactly
// the rows the chain describes. Clauses before `groupBy()` go through the
// same wrap, scoping the rows that get grouped.
describe('aggregate pagination', () => {
  it('aggregate() wraps take()/skip() in an input derived table', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .skip(5)
      .take(10)
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expect(ast.limit).toBeUndefined();
    expect(ast.offset).toBeUndefined();
    expectDerivedTableSource(ast.from);
    expect(ast.from.alias).toBe('posts');
    expect(ast.projection).toEqual([
      ProjectionItem.of('totalViews', AggregateExpr.sum(ColumnRef.of('posts', 'views')), {
        codecId: 'pg/int8number@1',
      }),
    ]);

    const innerSelect = ast.from.query;
    expect(innerSelect.limit).toBe(10);
    expect(innerSelect.offset).toBe(5);
    expect(innerSelect.projection).toEqual([
      ProjectionItem.of('views', ColumnRef.of('posts', 'views')),
    ]);
  });

  it('orderBy() carries into the wrapped inner select, not the outer one', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .orderBy((post) => post.views.desc())
      .skip(5)
      .take(10)
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expect(ast.orderBy).toBeUndefined();
    expectDerivedTableSource(ast.from);
    expect(ast.from.query.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('posts', 'views'))]);
  });

  it('wraps a multi-selector spec into one inner column per distinct selector.column, no stray __row', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ total: 3, sumViews: 500, avgViews: 166.67 }]]);

    await collection
      .skip(5)
      .take(10)
      .aggregate((aggregate) => ({
        total: aggregate.count(),
        sumViews: aggregate.sum(numericField),
        avgViews: aggregate.avg(numericField),
      }));

    const ast = selectAstOf(runtime);
    expectDerivedTableSource(ast.from);
    expect(ast.from.query.projection).toEqual([
      ProjectionItem.of('views', ColumnRef.of('posts', 'views')),
    ]);
  });

  it('aggregate() compiles a different plan with pagination', async () => {
    const unpaginated = createCollectionFor('Post');
    unpaginated.runtime.setNextResults([[{ total: 3 }]]);
    await unpaginated.collection.aggregate((aggregate) => ({ total: aggregate.count() }));

    const paginated = createCollectionFor('Post');
    paginated.runtime.setNextResults([[{ total: 3 }]]);
    await paginated.collection
      .skip(5)
      .take(10)
      .aggregate((aggregate) => ({ total: aggregate.count() }));

    expect(selectAstOf(paginated.runtime)).not.toEqual(selectAstOf(unpaginated.runtime));
  });

  it('groupBy().aggregate() wraps pre-group take()/skip() in an input derived table', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ userId: 1, totalViews: 500 }]]);

    await collection
      .skip(5)
      .take(10)
      .groupBy('userId')
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expect(ast.limit).toBeUndefined();
    expect(ast.offset).toBeUndefined();
    expectDerivedTableSource(ast.from);
    expect(ast.from.alias).toBe('posts');
    expect(ast.groupBy).toEqual([ColumnRef.of('posts', 'user_id')]);

    const innerSelect = ast.from.query;
    expect(innerSelect.limit).toBe(10);
    expect(innerSelect.offset).toBe(5);
    // The group key travels through the wrap alongside the aggregated
    // column — GROUP BY posts.user_id needs it in the wrap's projection.
    expect(innerSelect.projection).toEqual([
      ProjectionItem.of('user_id', ColumnRef.of('posts', 'user_id')),
      ProjectionItem.of('views', ColumnRef.of('posts', 'views')),
    ]);
  });

  // Discriminating case: pre-group and post-group pagination are separate
  // clauses at separate levels. If they merged, one of these two `take()`
  // values would win and the other would vanish.
  it('pre-group and post-group pagination land in separate places, not merged', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ userId: 1, totalViews: 500 }]]);

    await collection
      .orderBy((post) => post.views.desc())
      .take(10)
      .groupBy('userId')
      .orderBy((group) => group.userId.asc())
      .take(2)
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expect(ast.limit).toBe(2);
    expect(ast.orderBy).toEqual([OrderByItem.asc(ColumnRef.of('posts', 'user_id'))]);
    expectDerivedTableSource(ast.from);
    expect(ast.from.query.limit).toBe(10);
    expect(ast.from.query.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('posts', 'views'))]);
  });

  it('skip() without take() emits OFFSET with no LIMIT', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .skip(5)
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expectDerivedTableSource(ast.from);
    const innerSelect = ast.from.query;
    expect(innerSelect.limit).toBeUndefined();
    expect(innerSelect.offset).toBe(5);
  });

  it('cursor on an unpaginated aggregate reaches WHERE without a derived table', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .orderBy((post) => post.views.asc())
      .cursor({ views: 100 })
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const ast = selectAstOf(runtime);
    expect(ast.from).not.toBeInstanceOf(DerivedTableSource);
    expect(ast.limit).toBeUndefined();
    expect(ast.offset).toBeUndefined();
    expect(ast.where).toEqual(
      bindWhereExpr(
        baseContract,
        BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
      ),
    );
  });

  it('no ParamRef instance crosses the derived-table boundary twice', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ totalViews: 500 }]]);

    await collection
      .where((post) => post.views.gte(100))
      .skip(5)
      .take(10)
      .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

    const execution = runtime.executions[0];
    if (execution === undefined) {
      throw new Error('Expected the aggregate chain to run one execution');
    }
    const rawParamRefs = execution.plan.ast.collectParamRefs();
    expect(rawParamRefs).toHaveLength(new Set(rawParamRefs).size);
  });

  it('every selector lacking a column wraps to an inner projection of exactly __row', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ total: 3 }]]);

    await collection.take(10).aggregate((aggregate) => ({ total: aggregate.count() }));

    const ast = selectAstOf(runtime);
    expectDerivedTableSource(ast.from);
    expect(ast.from.query.projection).toEqual([ProjectionItem.of('__row', LiteralExpr.of(1))]);
  });

  describe('distinct() / distinctOn()', () => {
    it('distinct() alone wraps the source in a ROW_NUMBER dedup', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ totalViews: 500 }]]);

      await collection
        .distinct('title')
        .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

      const ast = selectAstOf(runtime);
      expectDerivedTableSource(ast.from);
      expect(ast.from.alias).toBe('posts');

      const aggregateInput = ast.from.query;
      expect(aggregateInput.orderBy).toBeUndefined();
      expectDerivedTableSource(aggregateInput.from);
      expect(aggregateInput.from.alias).toBe('posts');
    });

    // Postgres requires DISTINCT ON expressions to match the leading ORDER BY
    // expressions (`orderBy((p) => p.title.asc())` leads with the same
    // `title` column `distinctOn('title')` names, with `views` as a
    // tiebreaker) — mirrors the valid usage documented at
    // `collection.ts:920-924`. A chain whose orderBy doesn't lead with the
    // distinctOn columns is a plan the database rejects, not one this test
    // should assert.
    it('distinctOn() lowers to native DISTINCT ON with orderBy applied on the same select', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ totalViews: 500 }]]);

      await collection
        .orderBy([(post) => post.title.asc(), (post) => post.views.desc()])
        .distinctOn('title')
        .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

      const ast = selectAstOf(runtime);
      expectDerivedTableSource(ast.from);
      const aggregateInput = ast.from.query;
      expect(aggregateInput.from).not.toBeInstanceOf(DerivedTableSource);
      expect(aggregateInput.distinctOn).toEqual([ColumnRef.of('posts', 'title')]);
      expect(aggregateInput.orderBy).toEqual([
        OrderByItem.asc(ColumnRef.of('posts', 'title')),
        OrderByItem.desc(ColumnRef.of('posts', 'views')),
      ]);
    });

    // Discriminating case: `take(2)` must slice the ordered, deduped rows
    // — the top 2 by views — not an arbitrarily-ordered set.
    it('orderBy resolves directly through the ranked-input alias, no reapplication needed', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ totalViews: 500 }]]);

      await collection
        .distinct('title')
        .orderBy((post) => post.views.desc())
        .take(2)
        .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

      const ast = selectAstOf(runtime);
      expectDerivedTableSource(ast.from);
      expect(ast.from.alias).toBe('posts');

      const aggregateInput = ast.from.query;
      expect(aggregateInput.limit).toBe(2);
      expectDerivedTableSource(aggregateInput.from);
      expect(aggregateInput.from.alias).toBe('posts');
      expect(aggregateInput.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('posts', 'views'))]);
    });

    it('distinct() combined with skip() (no take()) emits OFFSET with no LIMIT on the deduped select', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ totalViews: 500 }]]);

      await collection
        .distinct('title')
        .skip(3)
        .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

      const ast = selectAstOf(runtime);
      expectDerivedTableSource(ast.from);
      const aggregateInput = ast.from.query;
      expect(aggregateInput.limit).toBeUndefined();
      expect(aggregateInput.offset).toBe(3);
      expectDerivedTableSource(aggregateInput.from);
      expect(aggregateInput.from.alias).toBe('posts');
    });

    it('distinct() combined with cursor() carries the cursor boundary onto the pre-dedup select', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ totalViews: 500 }]]);

      await collection
        .orderBy((post) => post.views.asc())
        .cursor({ views: 100 })
        .distinct('title')
        .aggregate((aggregate) => ({ totalViews: aggregate.sum(numericField) }));

      const ast = selectAstOf(runtime);
      expectDerivedTableSource(ast.from);
      const aggregateInput = ast.from.query;
      expectDerivedTableSource(aggregateInput.from);
      expect(aggregateInput.from.alias).toBe('posts');

      const dedupBase = aggregateInput.from.query;
      expect(dedupBase.where).toEqual(
        bindWhereExpr(
          baseContract,
          BinaryExpr.gt(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ),
      );
    });
  });
});
