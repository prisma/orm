import type { Op } from './shared';

/**
 * Identity factory for an already-materialized `SqlMigrationPlanOperation`.
 *
 * The planner uses this via `liftOpToCall` to carry ops produced by SQL
 * family methods, codec control hooks, and component database dependencies
 * alongside migration IR without reverse-engineering them. Users writing
 * raw migrations can pass a full op shape directly — typically built by
 * composing SQL family helpers — to author a migration that bypasses the
 * structured call classes.
 */
export function rawSql(op: Op): Op {
  return op;
}
