import type { Contract } from '@internal/contract/types';
import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Adapter, AnyQueryAst, LoweredStatement } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';

/**
 * Lowers a SQL query plan to an executable Plan by calling the adapter's lower method.
 *
 * Ad-hoc lowerings produce only `{kind: 'literal'}` slots; this helper
 * unwraps them into the bare-value array `SqlExecutionPlan` exposes.
 * Encountering a `{kind: 'bind'}` slot here means the caller passed an
 * AST containing `PreparedParamRef` to the ad-hoc execute path — that's a
 * caller error, surfaced as `RUNTIME.PREPARE_BIND_ON_ADHOC`.
 */
export function lowerSqlPlan<Row>(
  adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>,
  contract: Contract<SqlStorage>,
  queryPlan: SqlQueryPlan<Row>,
): SqlExecutionPlan<Row> {
  const lowered = adapter.lower(queryPlan.ast, {
    contract,
    params: queryPlan.params,
  });

  const params: unknown[] = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw runtimeError(
      'RUNTIME.PREPARE_BIND_ON_ADHOC',
      `The plan has a bind site for '${slot.name}'. A plan built inside prepare(...) runs only as a prepared statement.`,
      { name: slot.name },
    );
  });

  return Object.freeze({
    sql: lowered.sql,
    params,
    ast: queryPlan.ast,
    meta: queryPlan.meta,
  });
}
