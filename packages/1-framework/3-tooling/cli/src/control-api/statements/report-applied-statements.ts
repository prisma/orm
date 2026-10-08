import type { ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type MigrationStatementJson,
  migrationStatementJson,
} from '@internal/framework-components/control';

/**
 * A statement a plan applied, as the CLI reports it: the statement as JSON output writes it, the
 * positions of its operations in the result's `operations`, and its description.
 */
export interface AppliedStatementReport {
  readonly statement: MigrationStatementJson;
  readonly operationIndexes: readonly number[];
  /** The statement in domain names, for example `rename model "Profile" to "User"`. */
  readonly description: string;
}

/**
 * `operationOffset` is the number of operations the result lists before the plan that applied the
 * statements, so that each position indexes the result's `operations`.
 */
export function reportAppliedStatements(
  applied: readonly AppliedMigrationStatement[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
  operationOffset: number,
): readonly AppliedStatementReport[] {
  return applied.map((entry) => ({
    statement: migrationStatementJson(entry.statement),
    operationIndexes: entry.operationIndexes.map((index) => operationOffset + index),
    description: describeMigrationStatement(entry.statement, fromContract ?? contract, contract),
  }));
}
