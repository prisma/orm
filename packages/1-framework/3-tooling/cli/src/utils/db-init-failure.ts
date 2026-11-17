import type {
  MigrationOperationClass,
  MigrationPlannerConflict,
  MigrationRunnerFailure,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { DB_UPDATE_POLICY } from '../control-api/operations/db-update-policy';
import type { RunnerFailureFacts } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { ActionableCliError, errorMigrationPlanningFailed } from './cli-errors';
import { dbInitFailedPrecheckAdvice } from './failed-precheck-advice';
import { chooseAction, editFileAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';
import { dbInitRowsWithoutValueAdvice } from './runner-failure-advice';
import { runnerFailureError } from './runner-failure-error';
import { schemaCheckIssues } from './schema-check-issues';

const DB_INIT_ADDITIVE_ONLY_FIX =
  '`db init` applies only additive changes. Run `{bin} db update`, which also applies widening and destructive ones once you answer what each operation that would lose data means, with `--delete` or `--rename`.';

const DB_INIT_NEEDS_MIGRATION_FIX =
  '`db init` applies only additive changes, and `db update` does not apply data operations. Plan a migration with `{bin} migration plan`, which can include them, and apply it with `{bin} db migrate`.';

/**
 * What to do instead of `db init` when its additive-only policy refused operations of the given classes: `db update` when its policy allows all of them, otherwise a planned migration.
 */
function adviceForRefusedClasses(refused: ReadonlySet<MigrationOperationClass>): {
  readonly fix: string;
  readonly nextAction: NextAction;
} {
  const allowedByDbUpdate: ReadonlySet<MigrationOperationClass> = new Set(
    DB_UPDATE_POLICY.allowedOperationClasses,
  );
  if (![...refused].every((operationClass) => allowedByDbUpdate.has(operationClass))) {
    return {
      fix: DB_INIT_NEEDS_MIGRATION_FIX,
      nextAction: runCommandAction(
        'Plan a migration, since db update does not apply data operations',
        '{bin} migration plan',
      ),
    };
  }
  return {
    fix: DB_INIT_ADDITIVE_ONLY_FIX,
    nextAction: runCommandAction(
      refused.has('destructive')
        ? 'Apply the change with db update, which asks what each operation that would lose data means'
        : 'Apply the change with db update',
      '{bin} db update',
    ),
  };
}

/**
 * `db init`'s planning failure: when its additive-only policy refused operations, it says to use
 * `db update` or a planned migration instead.
 */
export function dbInitPlanningFailedError(
  conflicts: readonly MigrationPlannerConflict[],
): CliStructuredError {
  const planningFailed = errorMigrationPlanningFailed({ conflicts });
  const refused = new Set(
    conflicts.flatMap((conflict) =>
      conflict.refusedOperationClass === undefined ? [] : [conflict.refusedOperationClass],
    ),
  );
  if (refused.size === 0) {
    return planningFailed;
  }
  const { fix, nextAction } = adviceForRefusedClasses(refused);
  return new ActionableCliError(planningFailed.code, planningFailed.message, {
    why: planningFailed.why,
    fix,
    nextActions: [nextAction],
    ...ifDefined('meta', planningFailed.meta),
    ...ifDefined('docsUrl', planningFailed.docsUrl),
  });
}

/** A failed `db init` apply as the CLI reports it. */
export function dbInitRunnerFailureError(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  invocation: CliInvocation,
): CliStructuredError {
  const init = cliCommand(invocation, 'db init');
  const advice =
    facts.rowsWithoutValue !== undefined
      ? dbInitRowsWithoutValueAdvice(facts.rowsWithoutValue, invocation)
      : schemaCheckIssues(failure) !== undefined
        ? [
            editFileAction(
              `Change the contract source to resolve the issues listed, re-run \`${cliCommand(invocation, 'contract emit')}\`, then re-run \`${init}\``,
            ),
          ]
        : facts.failedPrecheck !== undefined
          ? dbInitFailedPrecheckAdvice(invocation)
          : [
              chooseAction(
                `Fix the schema mismatch (db init is additive-only), or bring the database to the contract with \`${cliCommand(invocation, 'db update')}\`, which moves the database without a reset and asks before losing data`,
              ),
            ];
  return runnerFailureError(failure, advice);
}
