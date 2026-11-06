import type { ReferentialAction } from './ir/foreign-key';

/**
 * Maps each `ReferentialAction` value to the SQL keyword used in ON DELETE /
 * ON UPDATE clauses. Shared across the migration planner and adapter DDL
 * renderers — single source of truth for the action → SQL mapping.
 */
export const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};
