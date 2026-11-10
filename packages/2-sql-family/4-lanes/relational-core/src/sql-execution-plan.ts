import type { ExecutionPlan } from '@internal/framework-components/runtime';
import type { AnyQueryAst } from './ast/types';

/**
 * SQL-domain execution plan: a query lowered to the wire-level shape that a
 * SQL driver can run.
 *
 * The plan carries:
 * - `sql` — the rendered SQL text
 * - `params` — the bound parameter list
 * - `ast` — the pre-lowering AST, retained for decoding / telemetry / middleware
 * - `meta` — family-agnostic plan metadata (target, lane, hashes, ...)
 * - `_row` — phantom row type, propagated from the originating `SqlQueryPlan`
 *
 * Extends the framework-level `ExecutionPlan<Row>` marker so generic SPIs
 * (`RuntimeExecutor<SqlExecutionPlan>`, `RuntimeMiddleware<SqlExecutionPlan>`)
 * can be parameterized over it.
 *
 * Co-located with `SqlQueryPlan` (its pre-lowering counterpart) in the lanes
 * layer because lane-level utilities (`SqlPlan`) compose against the
 * executable shape and the lanes layer cannot depend on the runtime layer.
 */
export interface SqlExecutionPlan<Row = unknown> extends ExecutionPlan<Row> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast: AnyQueryAst;
}
