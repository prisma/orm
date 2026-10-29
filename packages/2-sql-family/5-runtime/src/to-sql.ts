import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { lowerSqlPlan } from './lower-sql-plan';
import type { SqlExecutionStack, SqlRuntimeAdapterInstance } from './sql-context';
import { validateSqlPlan } from './sql-family-adapter';

export interface RenderedSql {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface ToSqlMember {
  /**
   * Renders a plan from `sql`, `raw` or the ORM to the SQL and parameters it would run, with no database.
   *
   * `params` are the plan's values before codecs encode them for the driver. `beforeCompile` middleware is not applied. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would.
   */
  toSql(plan: SqlQueryPlan): RenderedSql;
}

export function createToSql<TTargetId extends string>(
  stack: SqlExecutionStack<TTargetId>,
  contract: Contract<SqlStorage>,
): ToSqlMember['toSql'] {
  let adapter: SqlRuntimeAdapterInstance<TTargetId> | undefined;
  return (plan) => {
    validateSqlPlan(plan, contract);
    adapter ??= stack.adapter.create(stack);
    const { sql, params } = lowerSqlPlan(adapter, contract, plan);
    return { sql, params };
  };
}
