import { describe, expect, it } from 'vitest';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ParamRef,
  PreparedParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';
import { createSqlParamRefMutator } from '../../src/exports/middleware';
import type { SqlExecutionPlan } from '../../src/sql-execution-plan';

function planWith(refs: readonly ParamRef[], values: readonly unknown[]): SqlExecutionPlan {
  const where =
    refs.length === 1 && refs[0]
      ? AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'email'), refs[0])])
      : AndExpr.of(
          refs.map((ref, i) =>
            BinaryExpr.eq(ColumnRef.of('user', i === 0 ? 'email' : 'name'), ref),
          ),
        );
  const ast = SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(where);
  return {
    sql: 'select "id" from "user" where ...',
    params: values,
    ast,
    meta: {} as SqlExecutionPlan['meta'],
  } as SqlExecutionPlan;
}

describe('createSqlParamRefMutator entries()', () => {
  it('surfaces ParamRef.codec.codecId on each entry', () => {
    const ref = ParamRef.of('a@b.com', {
      name: 'p1',
      codec: { codecId: 'sql/varchar@1' },
    });
    const mutator = createSqlParamRefMutator(planWith([ref], ['a@b.com']));

    const [entry] = [...mutator.entries()];

    expect(entry?.codecId).toBe('sql/varchar@1');
  });

  it('yields codecId undefined for ParamRefs constructed without a codec', () => {
    const ref = ParamRef.of(42, { name: 'p1' });
    const mutator = createSqlParamRefMutator(planWith([ref], [42]));

    const [entry] = [...mutator.entries()];

    expect(entry).toBeDefined();
    expect(entry!.codecId).toBeUndefined();
  });

  it('returns originalParams by reference identity when no mutation happens', () => {
    const ref = ParamRef.of(1, { name: 'p1', codec: { codecId: 'sql/int@1' } });
    const plan = planWith([ref], [1]);
    const mutator = createSqlParamRefMutator(plan);

    expect(mutator.currentParams()).toBe(plan.params);
  });

  it('returns a frozen copy carrying the mutation after replaceValue', () => {
    const ref = ParamRef.of(1, { name: 'p1', codec: { codecId: 'sql/int@1' } });
    const plan = planWith([ref], [1]);
    const mutator = createSqlParamRefMutator(plan);

    const [entry] = [...mutator.entries()];
    if (!entry) throw new Error('expected one entry');
    if (entry.codecId === undefined) {
      mutator.replaceValue(entry.ref, 99);
    } else {
      mutator.replaceValue(entry.ref, 99);
    }

    const next = mutator.currentParams();
    expect(next).not.toBe(plan.params);
    expect(next).toEqual([99]);
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('replaceValues writes every matching handle in one pass', () => {
    const ref1 = ParamRef.of('a', { name: 'p1', codec: { codecId: 'sql/text@1' } });
    const ref2 = ParamRef.of('b', { name: 'p2', codec: { codecId: 'sql/text@1' } });
    const plan = planWith([ref1, ref2], ['a', 'b']);
    const mutator = createSqlParamRefMutator(plan);
    const entries = [...mutator.entries()];

    mutator.replaceValues([
      { ref: entries[0]!.ref, newValue: 'AA' },
      { ref: entries[1]!.ref, newValue: 'BB' },
    ]);

    expect(mutator.currentParams()).toEqual(['AA', 'BB']);
  });

  it('silently ignores handles that do not belong to the plan', () => {
    const ref = ParamRef.of(1, { name: 'p1', codec: { codecId: 'sql/int@1' } });
    const plan = planWith([ref], [1]);
    const mutator = createSqlParamRefMutator(plan);
    type AnyHandle = Parameters<typeof mutator.replaceValue>[0];
    const alien = ParamRef.of(2, {
      name: 'p2',
      codec: { codecId: 'sql/int@1' },
    }) as unknown as AnyHandle;

    mutator.replaceValue(alien, 99);
    mutator.replaceValues([{ ref: alien, newValue: 99 }]);

    expect(mutator.currentParams()).toBe(plan.params);
  });

  it('falls back to ref.value when the params array is shorter than the ref list', () => {
    const ref = ParamRef.of('default', { name: 'p1', codec: { codecId: 'sql/text@1' } });
    const plan = planWith([ref], []);
    const mutator = createSqlParamRefMutator(plan);

    const [entry] = [...mutator.entries()];
    expect(entry?.value).toBe('default');
  });

  it('returns an empty entry list when the plan has no ast', () => {
    const ref = ParamRef.of(1, { name: 'p1', codec: { codecId: 'sql/int@1' } });
    const plan = planWith([ref], [1]);
    const astless = { ...plan, ast: undefined } as unknown as SqlExecutionPlan;
    const mutator = createSqlParamRefMutator(astless);

    expect([...mutator.entries()]).toEqual([]);
  });

  it('surfaces PreparedParamRef positions with their codecId and slot value', () => {
    const ref = PreparedParamRef.of('userId', { codecId: 'pg/int4@1' });
    const where = AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'id'), ref)]);
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(where);
    const plan: SqlExecutionPlan = {
      sql: 'select "id" from "user" where ...',
      params: [42],
      ast,
      meta: {} as SqlExecutionPlan['meta'],
    };

    const mutator = createSqlParamRefMutator(plan);
    const [entry] = [...mutator.entries()];

    expect(entry?.codecId).toBe('pg/int4@1');
    expect(entry?.value).toBe(42);
  });

  it('replaceValue overrides a PreparedParamRef slot, visible on re-walk', () => {
    const ref = PreparedParamRef.of('userId', { codecId: 'pg/int4@1' });
    const where = AndExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'id'), ref)]);
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(where);
    const plan: SqlExecutionPlan = {
      sql: 'select "id" from "user" where ...',
      params: [1],
      ast,
      meta: {} as SqlExecutionPlan['meta'],
    };

    const mutator = createSqlParamRefMutator(plan);
    const [first] = [...mutator.entries()];
    if (!first) throw new Error('expected one entry');
    if (first.codecId === undefined) {
      mutator.replaceValue(first.ref, 999);
    } else {
      mutator.replaceValue(first.ref, 999);
    }

    const [reWalked] = [...mutator.entries()];
    expect(reWalked?.value).toBe(999);
    expect(mutator.currentParams()).toEqual([999]);
  });

  it('yields undefined for a PreparedParamRef when the params array is shorter than the ref list', () => {
    const a = PreparedParamRef.of('a', { codecId: 'pg/int4@1' });
    const b = PreparedParamRef.of('b', { codecId: 'pg/int4@1' });
    const where = AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('user', 'id'), a),
      BinaryExpr.eq(ColumnRef.of('user', 'rank'), b),
    ]);
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(where);
    const plan: SqlExecutionPlan = {
      sql: 'select "id" from "user" where ...',
      params: [1],
      ast,
      meta: {} as SqlExecutionPlan['meta'],
    };

    const mutator = createSqlParamRefMutator(plan);
    const entries = [...mutator.entries()];

    expect(entries[0]?.value).toBe(1);
    expect(entries[1]?.value).toBeUndefined();
  });

  it('sees the mutated value when entries() is re-walked after replaceValue', () => {
    const ref = ParamRef.of(1, { name: 'p1', codec: { codecId: 'sql/int@1' } });
    const plan = planWith([ref], [1]);
    const mutator = createSqlParamRefMutator(plan);

    const [first] = [...mutator.entries()];
    if (!first) throw new Error('expected one entry');
    if (first.codecId === undefined) {
      mutator.replaceValue(first.ref, 42);
    } else {
      mutator.replaceValue(first.ref, 42);
    }

    const [reWalked] = [...mutator.entries()];
    expect(reWalked?.value).toBe(42);
  });
});
