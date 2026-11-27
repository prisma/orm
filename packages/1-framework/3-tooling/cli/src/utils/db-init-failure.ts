import type {
  MigrationOperationClass,
  MigrationPlannerConflict,
  MigrationRunnerFailure,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { DB_UPDATE_POLICY } from '../control-api/operations/db-update-policy';
import type { MigrationPlanArgument } from '../control-api/operations/plan-arguments';
import type { RunnerFailureFacts } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { ActionableCliError, errorMigrationPlanningFailed } from './cli-errors';
import { dbInitFailedPrecheckAdvice } from './failed-precheck-advice';
import { chooseAction, editFileAction, runCommandAction } from './next-actions';
import {
  type CliInvocation,
  cliCommand,
  planAction,
  printedPlan,
  quotedPlan,
} from './printed-command';
import {
  dbInitRowsWithoutValueAdvice,
  refusedForDatabaseCapabilities,
} from './runner-failure-advice';
import { runnerFailureError } from './runner-failure-error';
import { schemaCheckIssues } from './schema-check-issues';

const DB_INIT_ADDITIVE_ONLY_FIX =
  '`db init` applies only additive changes. Run `{bin} db update`, which also applies widening and destructive ones once you answer what each operation that would lose data means, with `--delete` or `--rename`.';

const DB_INIT_NEEDS_MIGRATION =
  '`db init` applies only additive changes, and `db update` does not apply data operations.';

/** Where the refused `db init` would plan its migration from, and how the CLI was run. */
interface DbInitPlanContext {
  readonly migrationPlanOrigin: MigrationPlanArgument;
  readonly invocation: CliInvocation | undefined;
}

/**
 * What to do instead of `db init` when its additive-only policy refused operations of the given classes: `db update` when its policy allows all of them, otherwise a planned migration.
 */
function adviceForRefusedClasses(
  refused: ReadonlySet<MigrationOperationClass>,
  context: DbInitPlanContext,
): {
  readonly fix: string;
  readonly nextAction: NextAction;
} {
  const allowedByDbUpdate: ReadonlySet<MigrationOperationClass> = new Set(
    DB_UPDATE_POLICY.allowedOperationClasses,
  );
  if (![...refused].every((operationClass) => allowedByDbUpdate.has(operationClass))) {
    const plan = printedPlan(context.invocation, { from: context.migrationPlanOrigin }, []);
    if (plan.kind === 'none') {
      return {
        fix: `${DB_INIT_NEEDS_MIGRATION} No migration can be planned for them. ${plan.reason}.`,
        nextAction: planAction('Plan a migration', plan),
      };
    }
    return {
      fix: `${DB_INIT_NEEDS_MIGRATION} Plan a migration with ${quotedPlan(plan)}, which can include them, and apply it with \`${cliCommand(context.invocation, 'db migrate')}\`.`,
      nextAction: planAction(
        'Plan a migration, since db update does not apply data operations',
        plan,
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
  context: DbInitPlanContext,
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
  const { fix, nextAction } = adviceForRefusedClasses(refused, context);
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
  const advice = refusedForDatabaseCapabilities(failure)
    ? []
    : facts.rowsWithoutValue !== undefined
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
