import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import type { MigrationPlanArgument } from '../control-api/operations/plan-arguments';
import type { RunnerFailureFacts } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { chooseAction, editFileAction } from './next-actions';
import { type CliInvocation, cliCommand, dbUpdateRerun } from './printed-command';
import {
  blockingObjectsAdvice,
  dbUpdateFailedTypeChangeAdvice,
  dbUpdateRowsFailingCheckAdvice,
  dbUpdateRowsHoldingValueAdvice,
  dbUpdateRowsWithoutValueAdvice,
} from './runner-failure-advice';
import { runnerFailureError } from './runner-failure-error';
import { schemaCheckIssues } from './schema-check-issues';

/**
 * A failed `db update` apply as the CLI reports it. `migrationPlanOrigin` is the `--from` a
 * `migration plan` for this database takes.
 */
export function dbUpdateRunnerFailureError(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  context: {
    readonly migrationPlanOrigin: MigrationPlanArgument;
    readonly invocation: CliInvocation;
  },
): CliStructuredError {
  const { migrationPlanOrigin, invocation } = context;
  const update = dbUpdateRerun(invocation);
  const { blockingObjects } = failure.meta;
  const advice =
    blockingObjects !== undefined
      ? blockingObjectsAdvice(blockingObjects, update)
      : facts.failedTypeChange !== undefined
        ? dbUpdateFailedTypeChangeAdvice(facts.failedTypeChange, migrationPlanOrigin, invocation)
        : facts.rowsWithoutValue !== undefined
          ? dbUpdateRowsWithoutValueAdvice(facts.rowsWithoutValue, migrationPlanOrigin, invocation)
          : facts.rowsHoldingValue !== undefined
            ? dbUpdateRowsHoldingValueAdvice(
                facts.rowsHoldingValue,
                migrationPlanOrigin,
                invocation,
              )
            : facts.rowsFailingCheck !== undefined
              ? dbUpdateRowsFailingCheckAdvice(
                  facts.rowsFailingCheck,
                  migrationPlanOrigin,
                  invocation,
                )
              : schemaCheckIssues(failure) !== undefined
                ? [
                    editFileAction(
                      `Change the contract source to resolve the issues listed, re-run \`${cliCommand(invocation, 'contract emit')}\`, then re-run \`${update}\``,
                    ),
                  ]
                : [chooseAction(`Resolve the cause the failure names, then re-run \`${update}\``)];
  return runnerFailureError(failure, advice);
}
