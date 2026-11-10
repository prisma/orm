/**
 * Type-test: what a prepared statement was built from decides how it can be
 * consumed. A plan declaring statement statistics prepares into a handle that
 * only executes; a plan declaring rows prepares into one that only streams.
 */

import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import type { PreparedExecution, PreparedStatement } from '../src/prepared/types';
import type { Runtime } from '../src/sql-runtime';

declare const runtime: Runtime;
declare const statsPlan: SqlQueryPlan<AffectedCount>;
declare const rowsPlan: SqlQueryPlan<{ id: number }>;

test('a statistics plan prepares into an execution handle', async () => {
  const prepared = await runtime.prepare({}, () => statsPlan);

  expectTypeOf(prepared).toEqualTypeOf<PreparedExecution<Record<never, never>>>();
  expectTypeOf(prepared.execute(runtime, {})).toEqualTypeOf<Promise<SqlStatementStats>>();
});

test('a rows plan prepares into a row-streaming statement', async () => {
  const prepared = await runtime.prepare({}, () => rowsPlan);

  expectTypeOf(prepared).toEqualTypeOf<PreparedStatement<Record<never, never>, { id: number }>>();
  expectTypeOf(prepared.query(runtime, {})).toEqualTypeOf<AsyncIterableResult<{ id: number }>>();
});

test('an execution handle cannot be consumed as a row stream', async () => {
  const prepared = await runtime.prepare({}, () => statsPlan);

  // @ts-expect-error — a statement reporting statistics streams no rows
  prepared.query(runtime, {});
});

test('a row-streaming statement cannot be consumed as statistics', async () => {
  const prepared = await runtime.prepare({}, () => rowsPlan);

  // @ts-expect-error — a row-streaming statement reports no statistics
  prepared.execute(runtime, {});
});

// ── A row spec is free to declare a column named `affectedRows` ──────────────

declare const statsShapedRowsPlan: SqlQueryPlan<{ affectedRows: number }>;
declare const statsSupersetRowsPlan: SqlQueryPlan<{ affectedRows: number; id: string }>;

test('a rows plan shaped exactly like statistics prepares as a row statement', async () => {
  const prepared = await runtime.prepare({}, () => statsShapedRowsPlan);

  expectTypeOf(prepared).toEqualTypeOf<
    PreparedStatement<Record<never, never>, { affectedRows: number }>
  >();
  // @ts-expect-error — the plan declares rows, so there is nothing to execute
  prepared.execute(runtime, {});
});

test('a rows plan whose columns include affectedRows prepares as a row statement', async () => {
  const prepared = await runtime.prepare({}, () => statsSupersetRowsPlan);

  expectTypeOf(prepared).toEqualTypeOf<
    PreparedStatement<Record<never, never>, { affectedRows: number; id: string }>
  >();
  // @ts-expect-error — the plan declares rows, so there is nothing to execute
  prepared.execute(runtime, {});
});
