import {
  AggregateExpr,
  type AnyExpression,
  type BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
  OrderByItem,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';
import { isSelectAst } from './helpers';

describe('GroupedCollection', () => {
  it('groupBy().aggregate() maps grouped columns back to model fields', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    expect(rows).toEqual([{ userId: 1, count: 2 }]);
  });

  it('having() compiles aggregate predicates into HAVING clauses', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, totalViews: 50 }]]);

    const numericField = 'views' as never;
    const rows = await collection
      .groupBy('userId')
      .having((having) => having.count().gte(1))
      .aggregate((aggregate) => ({
        totalViews: aggregate.sum(numericField),
      }));

    expect(rows).toEqual([{ userId: 1, totalViews: 50 }]);
    const firstAst = runtime.executions[0]?.plan.ast;
    expect(isSelectAst(firstAst)).toBe(true);
    if (!isSelectAst(firstAst)) {
      throw new Error('Expected first execution plan to be a select SQL query plan');
    }
    expect(firstAst.having?.kind).toBe('binary');
    if (firstAst.having?.kind === 'binary') {
      expect((firstAst.having as BinaryExpr).left).toEqual(AggregateExpr.count());
    }
    const totalViewsProjection = firstAst.projection.find((item) => item.alias === 'totalViews');
    expect(totalViewsProjection?.expr.kind).toBe('aggregate');
    expect((totalViewsProjection!.expr as AggregateExpr).fn).toBe('sum');
  });

  it.each<{ kind: string; expression: AnyExpression }>([
    {
      kind: 'function-call',
      expression: FunctionCallExpr.of('lower', [LiteralExpr.of('value')]),
    },
    {
      kind: 'cast',
      expression: CastExpr.as(LiteralExpr.of('value'), 'text'),
    },
    {
      kind: 'case',
      expression: CaseExpr.of([
        {
          condition: LiteralExpr.of(true),
          value: LiteralExpr.of('value'),
        },
      ]),
    },
  ])('rejects $kind expressions in grouped HAVING', async ({ kind, expression }) => {
    const { collection } = createCollectionFor('Post');

    await expect(
      collection
        .groupBy('userId')
        .having(() => expression)
        .aggregate((aggregate) => ({ count: aggregate.count() })),
    ).rejects.toThrow(`Unsupported grouped having expression kind "${kind}"`);
  });

  it('groupBy().aggregate() validates selector shape and non-empty spec', async () => {
    const { collection } = createCollectionFor('Post');

    await expect(collection.groupBy('userId').aggregate(() => ({}))).rejects.toThrow(
      /requires at least one aggregation selector/,
    );

    await expect(
      collection
        .groupBy('userId')
        .aggregate(() => ({ invalid: { kind: 'unknown', fn: 'count' } as never })),
    ).rejects.toThrow(/selector "invalid" is invalid/);
  });

  it('groupBy().having() supports all metrics and comparison operators', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
      [{ user_id: 1, total: '20', avg: '10', min: '5', max: '15', count: '2' }],
    ]);

    const numericField = 'views' as never;

    await collection
      .groupBy('userId')
      .having((having) => having.sum(numericField).eq(20))
      .aggregate((aggregate) => ({ total: aggregate.sum(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.avg(numericField).neq(99))
      .aggregate((aggregate) => ({ avg: aggregate.avg(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.min(numericField).gt(4))
      .aggregate((aggregate) => ({ min: aggregate.min(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.max(numericField).lt(99))
      .aggregate((aggregate) => ({ max: aggregate.max(numericField) }));
    await collection
      .groupBy('userId')
      .having((having) => having.count().gte(2))
      .aggregate((aggregate) => ({ count: aggregate.count() }));
    await collection
      .groupBy('userId')
      .having((having) => having.count().lte(2))
      .aggregate((aggregate) => ({ count: aggregate.count() }));

    const havingComparisons = runtime.executions
      .map((entry) => {
        if (!isSelectAst(entry.plan.ast)) {
          return undefined;
        }
        const having = entry.plan.ast.having;
        if (having?.kind !== 'binary' || having.left.kind !== 'aggregate') {
          return undefined;
        }
        return `${having.left.fn}:${having.op}`;
      })
      .filter((comparison): comparison is string => comparison !== undefined);

    expect(havingComparisons).toHaveLength(6);
    expect(new Set(havingComparisons)).toEqual(
      new Set(['sum:eq', 'avg:neq', 'min:gt', 'max:lt', 'count:gte', 'count:lte']),
    );
  });

  // Aggregate values reach the row already decoded — the projection carries
  // each aggregate's resolved output codec, so the runtime's decode pass has
  // turned the wire value into the application one. Nothing re-reads them here,
  // which is what lets a `countBigInt` past 2^53 survive as the bigint it is.
  it('groupBy().aggregate() carries decoded aggregate values through unchanged', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([
      [
        {
          user_id: 1,
          count: 9007199254740993n,
          total: '10.5',
          max: 42,
        },
      ],
    ]);

    const numericField = 'views' as never;
    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.countBigInt(),
      total: aggregate.sum(numericField),
      max: aggregate.max(numericField),
    }));

    expect(rows).toEqual([{ userId: 1, count: 9007199254740993n, total: '10.5', max: 42 }]);
  });

  it('groupBy().aggregate() carries a null aggregate through as null', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: 0, total: null, avg: null }]]);

    const numericField = 'views' as never;
    const rows = await collection.groupBy('userId').aggregate((aggregate) => ({
      count: aggregate.count(),
      total: aggregate.sum(numericField),
      avg: aggregate.avg(numericField),
    }));

    expect(rows).toEqual([{ userId: 1, count: 0, total: null, avg: null }]);
  });

  it('only exposes grouped operations at runtime', () => {
    const { collection } = createCollectionFor('Post');
    const grouped = collection.groupBy('userId') as unknown as Record<string, unknown>;

    expect(typeof grouped['having']).toBe('function');
    expect(typeof grouped['aggregate']).toBe('function');
    expect(typeof grouped['take']).toBe('function');
    expect(typeof grouped['skip']).toBe('function');
    expect(typeof grouped['orderBy']).toBe('function');
    expect(grouped['all']).toBeUndefined();
    expect(grouped['first']).toBeUndefined();
    expect(grouped['include']).toBeUndefined();
    expect(grouped['select']).toBeUndefined();
  });

  describe('post-group take() / skip() / orderBy()', () => {
    it('take() applies LIMIT to the grouped select', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

      await collection
        .groupBy('userId')
        .orderBy((group) => group.userId.asc())
        .take(5)
        .aggregate((aggregate) => ({ count: aggregate.count() }));

      const ast = runtime.executions[0]?.plan.ast;
      if (!isSelectAst(ast)) {
        throw new Error('Expected the grouped execution plan to be a select SQL query plan');
      }
      expect(ast.limit).toBe(5);
    });

    it('skip() applies OFFSET to the grouped select', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

      await collection
        .groupBy('userId')
        .orderBy((group) => group.userId.asc())
        .skip(3)
        .aggregate((aggregate) => ({ count: aggregate.count() }));

      const ast = runtime.executions[0]?.plan.ast;
      if (!isSelectAst(ast)) {
        throw new Error('Expected the grouped execution plan to be a select SQL query plan');
      }
      expect(ast.offset).toBe(3);
    });

    it('orderBy() orders the grouped select by the group key', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

      await collection
        .groupBy('userId')
        .orderBy((group) => group.userId.desc())
        .aggregate((aggregate) => ({ count: aggregate.count() }));

      const ast = runtime.executions[0]?.plan.ast;
      if (!isSelectAst(ast)) {
        throw new Error('Expected the grouped execution plan to be a select SQL query plan');
      }
      expect(ast.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('posts', 'user_id'))]);
    });

    it('repeated orderBy() calls append, left-to-right', async () => {
      const { collection, runtime } = createCollectionFor('Post');
      runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

      await collection
        .groupBy('userId')
        .orderBy((group) => group.userId.asc())
        .orderBy((group) => group.userId.desc())
        .aggregate((aggregate) => ({ count: aggregate.count() }));

      const ast = runtime.executions[0]?.plan.ast;
      if (!isSelectAst(ast)) {
        throw new Error('Expected the grouped execution plan to be a select SQL query plan');
      }
      expect(ast.orderBy).toEqual([
        OrderByItem.asc(ColumnRef.of('posts', 'user_id')),
        OrderByItem.desc(ColumnRef.of('posts', 'user_id')),
      ]);
    });

    // The type gate refuses an empty selector list at compile time
    // (grouped-pagination-gate.test-d.ts); this covers a plain-JS caller
    // with no types to catch it. An empty orderBy() must not silently
    // satisfy the "has an order" gate — it orders by nothing.
    it('rejects an empty selector list at runtime', () => {
      const { collection } = createCollectionFor('Post');

      expect(() => collection.groupBy('userId').orderBy([] as never)).toThrow(
        'orderBy() for model "Post" requires at least one selector',
      );
    });
  });
});
