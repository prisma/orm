import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { SqlStatementStats } from '../src/ast/driver-types';
import type { SqlQueryPlan } from '../src/plan';
import type { RuntimeScope } from '../src/runtime-scope';
import type { SqlExecutionPlan } from '../src/sql-execution-plan';

declare const runtime: RuntimeScope;
declare const rowPlan: SqlExecutionPlan<{ readonly id: number }>;
declare const queryPlan: SqlQueryPlan<{ readonly id: number }>;

test('RuntimeScope separates row queries from statistics execution', () => {
  expectTypeOf(runtime.query(rowPlan)).toEqualTypeOf<
    AsyncIterableResult<{ readonly id: number }>
  >();
  expectTypeOf(runtime.execute(rowPlan)).toEqualTypeOf<Promise<SqlStatementStats>>();
  expectTypeOf(runtime.execute(queryPlan)).toEqualTypeOf<Promise<SqlStatementStats>>();
});
