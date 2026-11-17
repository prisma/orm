import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  PreparedParamRef,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { createSqlExecutionStack, createToSql } from '../src/exports';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContract,
  createTestTargetDescriptor,
} from './utils';

const contract = createTestContract({});

function planWhere(
  value: ParamRef | PreparedParamRef,
  meta: Partial<SqlQueryPlan['meta']> = {},
): SqlQueryPlan {
  return {
    ast: SelectAst.from(TableSource.named('users')).withWhere(
      BinaryExpr.eq(ColumnRef.of('users', 'id'), value),
    ),
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: 'sql',
      ...meta,
    },
  };
}

function setup() {
  const adapter = createTestAdapterDescriptor(createStubAdapter());
  const create = vi.spyOn(adapter, 'create');
  const stack = createSqlExecutionStack({ target: createTestTargetDescriptor(), adapter });
  return { create, toSql: createToSql(stack, contract) };
}

describe('createToSql', () => {
  it('returns the lowered SQL and the plan values, and nothing else', () => {
    const { toSql } = setup();
    const plan = planWhere(ParamRef.of(7, { codec: { codecId: 'pg/int4@1' } }));

    const rendered = toSql(plan);

    expect(Object.keys(rendered).sort()).toEqual(['params', 'sql']);
    expect(rendered.params).toEqual([7]);
    expect(rendered.sql).toContain('"users"');
  });

  it('creates the adapter on the first call, once', () => {
    const { create, toSql } = setup();
    expect(create).not.toHaveBeenCalled();

    toSql(planWhere(ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } })));
    toSql(planWhere(ParamRef.of(2, { codec: { codecId: 'pg/int4@1' } })));

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a plan with a prepare bind site', () => {
    const { toSql } = setup();

    expect(() => toSql(planWhere(PreparedParamRef.of('id', { codecId: 'pg/int4@1' })))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PREPARE_BIND_ON_ADHOC',
        message:
          "The plan has a bind site for 'id'. A plan built inside prepare(...) runs only as a prepared statement.",
      }),
    );
  });

  it('rejects a plan built for another contract, as the runtime does', () => {
    const { toSql } = setup();
    const value = ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } });

    expect(() => toSql(planWhere(value, { storageHash: 'other-contract' }))).toThrow(
      expect.objectContaining({ code: 'PLAN.HASH_MISMATCH' }),
    );
    expect(() => toSql(planWhere(value, { target: 'sqlite' }))).toThrow(
      expect.objectContaining({ code: 'PLAN.TARGET_MISMATCH' }),
    );
  });
});
