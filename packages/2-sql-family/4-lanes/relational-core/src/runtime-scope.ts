import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import type { SqlStatementStats } from './ast/driver-types';
import type { SqlQueryPlan } from './plan';
import type { SqlExecutionPlan } from './sql-execution-plan';

/**
 * The plan shape accepted by the SQL ORM client and SQL runtime: either a
 * pre-lowering `SqlQueryPlan` (AST + meta) or a post-lowering
 * `SqlExecutionPlan` (sql + params + meta).
 */
export type SqlOrmPlan<Row = unknown> = SqlExecutionPlan<Row> | SqlQueryPlan<Row>;

/**
 * The minimal SQL-runtime surface shared by row and statistics consumers.
 *
 * Owned by `sql-relational-core` (lanes layer) so both
 * `@internal/sql-runtime` and `@internal/sql-orm-client` consume the
 * same source of truth without a layering inversion.
 */
export interface RuntimeScope {
  query<Row>(plan: SqlOrmPlan<Row>, options?: RuntimeExecuteOptions): AsyncIterableResult<Row>;
  execute(plan: SqlOrmPlan, options?: RuntimeExecuteOptions): Promise<SqlStatementStats>;
}
