import type { PlanMeta } from '@internal/contract/types';
import type { ExecutionPlan, QueryPlan, ResultType } from '@internal/framework-components/runtime';
import { assertType, expectTypeOf, test } from 'vitest';
import type { AnyQueryAst } from '../src/ast/types';
import type { SqlExecutionPlan } from '../src/sql-execution-plan';

const meta: PlanMeta = {
  target: 'postgres',
  storageHash: 'test',
  lane: 'sql',
};

const ast = {} as AnyQueryAst;

test('SqlExecutionPlan extends framework ExecutionPlan and QueryPlan', () => {
  const plan: SqlExecutionPlan<{ id: number }> = {
    sql: 'SELECT 1',
    params: [],
    ast,
    meta,
  };
  assertType<ExecutionPlan<{ id: number }>>(plan);
  assertType<QueryPlan<{ id: number }>>(plan);
});

test('Row type is recoverable via ResultType', () => {
  const plan: SqlExecutionPlan<{ id: number; email: string }> = {
    sql: 'SELECT id, email FROM users',
    params: [],
    ast,
    meta,
  };
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toEqualTypeOf<{ id: number; email: string }>();
});
