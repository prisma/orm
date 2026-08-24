import {
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  LiteralExpr,
  OrderByItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileAggregate, compileGroupedAggregate } from '../src/query-plan';
import { emptyState } from '../src/types';
import { bindWhereExpr } from '../src/where-binding';
import { buildMixedPolyContract, getTestAggregates, isSelectAst } from './helpers';
import { featureJoin } from './variant-include.query-plan-fixtures';

function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

// A `.variant('Feature')`-narrowed Task resolves `priority` (variant-owned,
// MTI) to a ColumnRef qualified against `features`, mirroring what the
// model accessor produces (`model-accessor.ts:222-229`). Root
// `compileAggregate` must join `features` into its FROM the same way
// `compileSelect` does, or the plan references a table absent from its own
// FROM.
describe('MTI variant join in compileAggregate', () => {
  const contract = buildMixedPolyContract();

  it('joins the variant table for a variant-owned where() filter, unwrapped', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('features', 'priority'), LiteralExpr.of(3)),
    );

    const plan = compileAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Feature', filters: [filter] },
      { total: { kind: 'aggregate', fn: 'count' } },
      'Task',
    );

    expectSelectAst(plan.ast);
    expect(plan.ast.joins).toEqual([featureJoin]);
    expect(plan.ast.where).toEqual(filter);
  });

  it('joins the variant table for a variant-owned where() filter, wrapped', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('features', 'priority'), LiteralExpr.of(3)),
    );

    const plan = compileAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Feature', filters: [filter], limit: 10 },
      { total: { kind: 'aggregate', fn: 'count' } },
      'Task',
    );

    expectSelectAst(plan.ast);
    expectDerivedTableSource(plan.ast.from);
    const inner = plan.ast.from.query;
    expect(inner.joins).toEqual([featureJoin]);
    expect(inner.where).toEqual(filter);
  });

  // Discriminates: orderBy on a variant-owned column only ever reaches SQL
  // through the wrapped path (a bare orderBy stays inert otherwise), so this
  // is the one shape that would surface "missing FROM entry" without the
  // join — `inner.joins` comes back empty and `inner.orderBy`'s ColumnRef
  // points at a table the FROM never named.
  it('joins the variant table for a variant-owned orderBy(), wrapped', () => {
    const plan = compileAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      {
        ...emptyState(),
        variantName: 'Feature',
        orderBy: [OrderByItem.desc(ColumnRef.of('features', 'priority'))],
        limit: 10,
      },
      { total: { kind: 'aggregate', fn: 'count' } },
      'Task',
    );

    expectSelectAst(plan.ast);
    expectDerivedTableSource(plan.ast.from);
    const inner = plan.ast.from.query;
    expect(inner.joins).toEqual([featureJoin]);
    expect(inner.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('features', 'priority'))]);
  });

  // The join has to land on `inner` *before* the distinct branch so
  // `wrapWithRowNumberDedup` carries it into `base` — the ranked subquery —
  // where the hidden-order projection (built from this same variant-owned
  // orderBy) needs it in scope. Discriminates: applying the join after the
  // branch instead would leave it on the outer dedup select, and this
  // assertion reads `joins` off the *inner* (pre-dedup) select specifically.
  it('carries the variant join into the ROW_NUMBER dedup ranked subquery under distinct + orderBy', () => {
    const plan = compileAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      {
        ...emptyState(),
        variantName: 'Feature',
        distinct: ['title'],
        orderBy: [OrderByItem.desc(ColumnRef.of('features', 'priority'))],
        limit: 10,
      },
      { total: { kind: 'aggregate', fn: 'count' } },
      'Task',
    );

    expectSelectAst(plan.ast);
    expectDerivedTableSource(plan.ast.from);
    const aggregateInput = plan.ast.from.query;
    expectDerivedTableSource(aggregateInput.from);
    const rankedBase = aggregateInput.from.query;
    expect(rankedBase.joins).toEqual([featureJoin]);
  });

  // STI variant-owned columns live on the base table (`model-accessor.ts:
  // 222-229`) and never resolve to a variant-table ColumnRef, so
  // `buildMtiJoins` finds nothing to join for `Bug` — `bugs`'s storage table
  // is `tasks`, the base table itself, so it is absent from
  // `polyInfo.mtiVariants` entirely. No join is added, and none is needed.
  it('adds no join for an STI variant', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('tasks', 'severity'), LiteralExpr.of('major')),
    );

    const plan = compileAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Bug', filters: [filter] },
      { total: { kind: 'aggregate', fn: 'count' } },
      'Task',
    );

    expectSelectAst(plan.ast);
    expect(plan.ast.joins).toBeUndefined();
  });
});

// compileGroupedAggregate has never taken a modelName — grouped aggregates
// have never resolved MTI variant joins, wrapped or not. A pre-group
// scoping clause is what forces the wrap; without one the grouped path
// takes `tasks` unwrapped, so both branches are covered below.
describe('MTI variant join in compileGroupedAggregate', () => {
  const contract = buildMixedPolyContract();

  it('joins the variant table for a variant-owned filter, wrapped by a pre-group scoping clause', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('features', 'priority'), LiteralExpr.of(3)),
    );

    const plan = compileGroupedAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Feature', filters: [filter], limit: 10 },
      ['project_id'],
      { total: { kind: 'aggregate', fn: 'count' } },
      undefined,
      'Task',
    );

    expectSelectAst(plan.ast);
    expectDerivedTableSource(plan.ast.from);
    const inner = plan.ast.from.query;
    expect(inner.joins).toEqual([featureJoin]);
    expect(inner.where).toEqual(filter);
  });

  it('joins the variant table for a variant-owned filter, unwrapped (no pre-group scoping)', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('features', 'priority'), LiteralExpr.of(3)),
    );

    const plan = compileGroupedAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Feature', filters: [filter] },
      ['project_id'],
      { total: { kind: 'aggregate', fn: 'count' } },
      undefined,
      'Task',
    );

    expectSelectAst(plan.ast);
    expect(plan.ast.joins).toEqual([featureJoin]);
    expect(plan.ast.where).toEqual(filter);
  });

  it('adds no join for an STI variant', () => {
    const filter = bindWhereExpr(
      contract,
      BinaryExpr.gte(ColumnRef.of('tasks', 'severity'), LiteralExpr.of('major')),
    );

    const plan = compileGroupedAggregate(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      { ...emptyState(), variantName: 'Bug', filters: [filter] },
      ['project_id'],
      { total: { kind: 'aggregate', fn: 'count' } },
      undefined,
      'Task',
    );

    expectSelectAst(plan.ast);
    expect(plan.ast.joins).toBeUndefined();
  });
});
