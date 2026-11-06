import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  RuntimeScope as CanonicalRuntimeScope,
  SqlOrmPlan,
} from '@internal/sql-relational-core/types';
import type {
  ActivitySource,
  activitySource,
  Runtime,
  RuntimeQueryable as SqlRuntimeQueryable,
} from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { RuntimeQueryable } from '../src/types';

test('RuntimeScope from sql-relational-core is the canonical SQL runtime surface', () => {
  expectTypeOf<SqlOrmPlan>().toEqualTypeOf<SqlExecutionPlan | SqlQueryPlan>();
});

test('sql-runtime RuntimeQueryable extends the canonical RuntimeScope', () => {
  const runtimeQueryable = {} as SqlRuntimeQueryable;
  expectTypeOf(runtimeQueryable).toExtend<CanonicalRuntimeScope>();
});

test('SQL Runtime is structurally assignable to RuntimeQueryable', () => {
  const runtime = {} as Runtime;
  expectTypeOf(runtime).toExtend<RuntimeQueryable>();
});

test('RuntimeScope query returns rows and execute returns statistics', () => {
  type Row = { id: number; name: string };
  const plan = {} as SqlQueryPlan<Row>;
  const scope = {} as CanonicalRuntimeScope;
  expectTypeOf(scope.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(scope.execute(plan)).toEqualTypeOf<Promise<SqlStatementStats>>();
});

test('RuntimeScope query accepts a pre-lowered plan with a row binding', () => {
  type Row = { count: number };
  const plan = {} as SqlExecutionPlan<Row>;
  const scope = {} as CanonicalRuntimeScope;
  expectTypeOf(scope.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
});

test('RuntimeQueryable may carry an activity source, but need not', () => {
  expectTypeOf<Pick<RuntimeQueryable, 'query' | 'execute'>>().toExtend<RuntimeQueryable>();
  expectTypeOf<RuntimeQueryable[typeof activitySource]>().toEqualTypeOf<
    ActivitySource | undefined
  >();
  expectTypeOf<RuntimeQueryable>().not.toHaveProperty('startActivity');
  expectTypeOf<RuntimeQueryable>().not.toHaveProperty('planContentHash');
});
