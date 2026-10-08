import type { ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type MigrationStatementJson,
  type MigrationSubjectJson,
  migrationStatementJson,
  migrationSubjectJson,
} from '@internal/framework-components/control';
import type { ConsentVerb } from './parse-consent';
import { type ConsentedSubject, consentDescription } from './plan-questions';

/** A delete or allow statement in JSON output: the subject whose data or access it consents to. */
export interface ConsentStatementJson {
  readonly kind: ConsentVerb;
  readonly subject: MigrationSubjectJson;
}

/**
 * A statement a plan applied, as the CLI reports it: its verb, the statement as JSON output writes
 * it, the positions of its operations in the result's `operations`, and its description.
 */
export type AppliedStatementReport =
  | {
      readonly verb: 'rename';
      readonly statement: MigrationStatementJson;
      readonly operationIndexes: readonly number[];
      /** The statement in domain names, for example `rename model "Profile" to "User"`. */
      readonly description: string;
    }
  | {
      readonly verb: ConsentVerb;
      readonly statement: ConsentStatementJson;
      readonly operationIndexes: readonly number[];
      /** The statement as its question named the subject, for example `delete model "Legacy"`. */
      readonly description: string;
    };

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
    verb: 'rename',
    statement: migrationStatementJson(entry.statement),
    operationIndexes: entry.operationIndexes.map((index) => operationOffset + index),
    description: describeMigrationStatement(entry.statement, fromContract ?? contract, contract),
  }));
}

/** A delete or allow statement a plan applied, with the positions of the operations it consented to. */
export function reportConsentStatement(
  consented: ConsentedSubject,
  operationIndexes: readonly number[],
): AppliedStatementReport {
  return {
    verb: consented.verb,
    statement: { kind: consented.verb, subject: migrationSubjectJson(consented.subject) },
    operationIndexes,
    description: consentDescription(consented.verb, consented.subject, consented.text),
  };
}
