import type { Op } from './shared';

/**
 * Identity factory for an already-materialized
 * `SqlMigrationPlanOperation<SqlitePlanTargetDetails>`. Mirrors the Postgres
 * `rawSql` factory: the planner uses this to carry ops produced by SQL-family
 * paths (codec lifecycle hooks, raw-SQL escape hatches) alongside structured
 * call IR without reverse-engineering their shape.
 */
export function rawSql(op: Op): Op {
  return op;
}
