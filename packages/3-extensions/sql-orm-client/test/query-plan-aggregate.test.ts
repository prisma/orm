import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  ExistsExpr,
  FunctionCallExpr,
  IdentifierRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NativeJsonValueProjection,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan';
import { emptyState } from '../src/types';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract } from './collection-fixtures';
import { getTestAggregates } from './helpers';

const defaultAggSpec = {
  totalViews: { kind: 'aggregate' as const, fn: 'sum' as const, column: 'views' },
};

function compileWithHaving(having: AnyExpression) {
  return compileGroupedAggregate(
    baseContract,
    getTestAggregates(),
    'public',
    'posts',
    emptyState(),
    ['user_id'],
    defaultAggSpec,
    having,
  );
}

describe('query plan aggregate', () => {
  const filteredViews = bindWhereExpr(
    baseContract,
    BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
  );

  it('rejects empty aggregate specs and selectors without required fields', () => {
    expect(() =>
      compileAggregate(baseContract, getTestAggregates(), 'public', 'posts', emptyState(), {}),
    ).toThrow('aggregate() requires at least one aggregation selector');
    // Whether an operation answers a call without an input is the descriptor's
    // to declare; the target declares no such overload for sum.
    expect(() =>
      compileAggregate(baseContract, getTestAggregates(), 'public', 'posts', emptyState(), {
        totalViews: { kind: 'aggregate', fn: 'sum' },
      }),
    ).toThrow("The composed target declares no 'sum' aggregate for a call without an input");

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        [],
        {
          totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
        },
        undefined,
      ),
    ).toThrow('groupBy() requires at least one field');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        ['user_id'],
        {},
        undefined,
      ),
    ).toThrow('groupBy().aggregate() requires at least one aggregation selector');
  });

  it('validates grouped having expressions before lowering them', () => {
    const scalarSubquery = SelectAst.from(TableSource.named('posts')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
    ]);

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        BinaryExpr.gte(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ParamRef.of(1, { name: 'views', codec: { codecId: 'pg/int4@1' } }),
        ),
      ),
    ).toThrow('ParamRef is not supported in grouped having expressions');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListExpression.of([ParamRef.of(1, { name: 'views', codec: { codecId: 'pg/int4@1' } })]),
        ),
      ),
    ).toThrow('ParamRef is not supported in grouped having expressions');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        ExistsExpr.exists(scalarSubquery),
      ),
    ).toThrow('Unsupported grouped having expression kind "exists"');

    expect(() =>
      compileGroupedAggregate(
        baseContract,
        getTestAggregates(),
        'public',
        'posts',
        emptyState(),
        ['user_id'],
        { totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' } },
        NullCheckExpr.isNull(ColumnRef.of('posts', 'views')),
      ),
    ).toThrow('groupBy().having() only supports aggregate metric expressions');
  });

  it('keeps grouped aggregate HAVING expressions composed from aggregate metrics', () => {
    const plan = compileGroupedAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      AndExpr.of([
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListExpression.fromValues([1, 2]),
        ),
        NullCheckExpr.isNotNull(AggregateExpr.sum(ColumnRef.of('posts', 'views'))),
      ]),
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.groupBy).toEqual([ColumnRef.of('posts', 'user_id')]);
    expect(ast.having).toEqual(
      AndExpr.of([
        BinaryExpr.in(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)]),
        ),
        NullCheckExpr.isNotNull(AggregateExpr.sum(ColumnRef.of('posts', 'views'))),
      ]),
    );
  });

  it('keeps grouped aggregate HAVING with OR expressions', () => {
    const plan = compileGroupedAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      OrExpr.of([
        BinaryExpr.gte(
          AggregateExpr.sum(ColumnRef.of('posts', 'views')),
          ColumnRef.of('posts', 'views'),
        ),
        BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
      ]),
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.having).toBeInstanceOf(OrExpr);
  });

  it('keeps aggregate filters and params when lowering plain aggregate queries', () => {
    const plan = compileAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      { ...emptyState(), filters: [filteredViews] },
      {
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.where).toEqual(filteredViews);
    expect(plan.params).toEqual([100]);
    const params = [...new Set(plan.ast.collectParamRefs())];
    expect(params).toHaveLength(1);
    const firstParam = params[0];
    if (firstParam?.kind !== 'param-ref') throw new Error('expected param-ref');
    expect(firstParam.codec?.codecId).toBe('pg/int4@1');
  });

  it('stamps min/max ProjectionItem.codec from the underlying column', () => {
    const plan = compileAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      {
        minViews: { kind: 'aggregate', fn: 'min', column: 'views' },
        maxViews: { kind: 'aggregate', fn: 'max', column: 'views' },
      },
    );

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    const byAlias = Object.fromEntries(ast.projection.map((p) => [p.alias, p.codec?.codecId]));
    expect(byAlias).toEqual({ minViews: 'pg/int4@1', maxViews: 'pg/int4@1' });
  });

  // The result codec is the target's answer per operation and input, not a
  // rule the planner knows: over `pg/int4@1` the bare `sum` and `count` read as
  // `pg/int8number@1` and `avg` as `pg/float8@1`, whatever the database itself
  // computes them into.
  it('stamps the resolved output codec on count, sum, and avg', () => {
    const plan = compileAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      {
        total: { kind: 'aggregate', fn: 'count' },
        sumViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
        avgViews: { kind: 'aggregate', fn: 'avg', column: 'views' },
      },
    );

    const ast = plan.ast as SelectAst;
    const byAlias = Object.fromEntries(ast.projection.map((p) => [p.alias, p.codec?.codecId]));
    expect(byAlias).toEqual({
      total: 'pg/int8number@1',
      sumViews: 'pg/int8number@1',
      avgViews: 'pg/float8@1',
    });
  });

  it('stamps min/max codec on grouped aggregates too', () => {
    const plan = compileGroupedAggregate(
      baseContract,
      getTestAggregates(),
      'public',
      'posts',
      emptyState(),
      ['user_id'],
      { peakViews: { kind: 'aggregate', fn: 'max', column: 'views' } },
      undefined,
    );

    const ast = plan.ast as SelectAst;
    const peak = ast.projection.find((p) => p.alias === 'peakViews');
    expect(peak?.codec?.codecId).toBe('pg/int4@1');
  });

  describe('validateGroupedHavingExpr rejects non-predicate expression types', () => {
    it('rejects ColumnRef', () => {
      expect(() => compileWithHaving(ColumnRef.of('posts', 'views'))).toThrow(
        'Unsupported grouped having expression kind "column-ref"',
      );
    });

    it('rejects IdentifierRef', () => {
      expect(() => compileWithHaving(IdentifierRef.of('some_name'))).toThrow(
        'Unsupported grouped having expression kind "identifier-ref"',
      );
    });

    it('rejects SubqueryExpr', () => {
      const sub = SubqueryExpr.of(
        SelectAst.from(TableSource.named('posts')).withProjection([
          ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
        ]),
      );
      expect(() => compileWithHaving(sub)).toThrow(
        'Unsupported grouped having expression kind "subquery"',
      );
    });

    it('rejects OperationExpr', () => {
      const op = new OperationExpr({
        method: 'contains',
        self: ColumnRef.of('posts', 'title'),
        args: [LiteralExpr.of('test')],
        returns: { codecId: 'core/bool', nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: 'position({1} in {0}) > 0',
        },
      });
      expect(() => compileWithHaving(op)).toThrow(
        'Unsupported grouped having expression kind "operation"',
      );
    });

    it('rejects bare AggregateExpr', () => {
      expect(() => compileWithHaving(AggregateExpr.count())).toThrow(
        'Unsupported grouped having expression kind "aggregate"',
      );
    });

    it('rejects JsonObjectExpr', () => {
      const json = JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('x', new NativeJsonValueProjection(ColumnRef.of('posts', 'id'))),
      ]);
      expect(() => compileWithHaving(json)).toThrow(
        'Unsupported grouped having expression kind "json-object"',
      );
    });

    it('rejects JsonArrayAggExpr', () => {
      const agg = JsonArrayAggExpr.of(new NativeJsonValueProjection(ColumnRef.of('posts', 'id')));
      expect(() => compileWithHaving(agg)).toThrow(
        'Unsupported grouped having expression kind "json-array-agg"',
      );
    });

    it('rejects LiteralExpr', () => {
      expect(() => compileWithHaving(LiteralExpr.of(true))).toThrow(
        'Unsupported grouped having expression kind "literal"',
      );
    });

    it('rejects top-level ParamRef', () => {
      expect(() =>
        compileWithHaving(ParamRef.of(1, { name: 'x', codec: { codecId: 'pg/int4@1' } })),
      ).toThrow('ParamRef is not supported in grouped having expressions');
    });

    it('rejects ListExpression', () => {
      expect(() =>
        compileWithHaving(ListExpression.of([LiteralExpr.of(1), LiteralExpr.of(2)])),
      ).toThrow('Unsupported grouped having expression kind "list"');
    });
  });

  describe('validateGroupedHavingExpr rejects invalid expressions inside logical operators', () => {
    it('rejects invalid expression inside AND', () => {
      expect(() =>
        compileWithHaving(
          AndExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
            ColumnRef.of('posts', 'views'),
          ]),
        ),
      ).toThrow('Unsupported grouped having expression kind "column-ref"');
    });

    it('rejects invalid expression inside OR', () => {
      expect(() =>
        compileWithHaving(
          OrExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5)),
            LiteralExpr.of(true),
          ]),
        ),
      ).toThrow('Unsupported grouped having expression kind "literal"');
    });

    it('rejects invalid expression inside NOT', () => {
      expect(() => compileWithHaving(new NotExpr(AggregateExpr.count()))).toThrow(
        'Unsupported grouped having expression kind "aggregate"',
      );
    });
  });

  describe('validateGroupedHavingExpr accepts valid predicate expressions', () => {
    it('accepts NOT wrapping a valid binary', () => {
      const plan = compileWithHaving(
        new NotExpr(BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(5))),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });

    it('accepts NOT wrapping NullCheck', () => {
      const plan = compileWithHaving(
        new NotExpr(NullCheckExpr.isNull(AggregateExpr.sum(ColumnRef.of('posts', 'views')))),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });

    it('accepts nested NOT(AND(binary, binary))', () => {
      const plan = compileWithHaving(
        new NotExpr(
          AndExpr.of([
            BinaryExpr.gte(AggregateExpr.count(), LiteralExpr.of(1)),
            BinaryExpr.lte(AggregateExpr.sum(ColumnRef.of('posts', 'views')), LiteralExpr.of(100)),
          ]),
        ),
      );
      expect((plan.ast as SelectAst).having).toBeInstanceOf(NotExpr);
    });
  });

  describe('validateGroupedComparable rejects invalid right-side expressions', () => {
    it.each([
      {
        kind: 'function-call',
        expr: FunctionCallExpr.of('abs', [LiteralExpr.of(1)]),
      },
      {
        kind: 'cast',
        expr: CastExpr.as(LiteralExpr.of(1), 'integer'),
      },
      {
        kind: 'case',
        expr: CaseExpr.of([{ condition: LiteralExpr.of(true), value: LiteralExpr.of(1) }]),
      },
    ])('rejects $kind with a structured error', ({ kind, expr }) => {
      expect(() => compileWithHaving(BinaryExpr.gte(AggregateExpr.count(), expr))).toThrow(
        expect.objectContaining({
          name: 'StructuredError',
          code: 'ORM.HAVING_EXPRESSION_UNSUPPORTED',
          message: `Unsupported comparable kind in grouped having: "${kind}"`,
          meta: { kind },
        }),
      );
    });

    it('rejects SubqueryExpr on right side of binary', () => {
      const sub = SubqueryExpr.of(
        SelectAst.from(TableSource.named('posts')).withProjection([
          ProjectionItem.of('id', ColumnRef.of('posts', 'id')),
        ]),
      );
      expect(() => compileWithHaving(BinaryExpr.gte(AggregateExpr.count(), sub))).toThrow(
        'Unsupported comparable kind in grouped having: "subquery"',
      );
    });

    it('rejects JsonObjectExpr on right side of binary', () => {
      const json = JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('x', new NativeJsonValueProjection(LiteralExpr.of(1))),
      ]);
      expect(() => compileWithHaving(BinaryExpr.gte(AggregateExpr.count(), json))).toThrow(
        'Unsupported comparable kind in grouped having: "json-object"',
      );
    });
  });
});
