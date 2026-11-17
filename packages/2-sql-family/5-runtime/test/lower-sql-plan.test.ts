import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  PreparedParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { lowerSqlPlan } from '../src/lower-sql-plan';
import { createStubAdapter, createTestContract } from './utils';

const testContract = createTestContract({ targetFamily: 'sql', target: 'postgres' });

const meta = {
  target: testContract.target,
  storageHash: testContract.storage.storageHash,
  lane: 'dsl' as const,
};

function buildLiteralPlan(): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAst.from(users)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('id', 'users'),
        ParamRef.of(42, { codec: { codecId: 'pg/int4@1' } }),
      ),
    );
  return Object.freeze({ ast, params: [42], meta });
}

function buildBindSitePlan(): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAst.from(users)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('id', 'users'),
        PreparedParamRef.of('userId', { codecId: 'pg/int4@1' }),
      ),
    );
  return Object.freeze({ ast, params: [undefined], meta });
}

describe('lowerSqlPlan', () => {
  it('unwraps literal slots into a bare-value params array and freezes the result', () => {
    const adapter = createStubAdapter();
    const originalPlan = buildLiteralPlan();
    const plan = lowerSqlPlan(adapter, testContract, originalPlan);

    expect(plan.params).toEqual([42]);
    expect(plan.ast).toBe(originalPlan.ast);
    expect(plan.meta).toBe(meta);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('throws RUNTIME.PREPARE_BIND_ON_ADHOC when a bind-site slot reaches the ad-hoc path', () => {
    const adapter = createStubAdapter();
    expect(() => lowerSqlPlan(adapter, testContract, buildBindSitePlan())).toThrowError(
      expect.objectContaining({
        code: 'RUNTIME.PREPARE_BIND_ON_ADHOC',
        details: expect.objectContaining({ name: 'userId' }),
      }),
    );
  });
});
