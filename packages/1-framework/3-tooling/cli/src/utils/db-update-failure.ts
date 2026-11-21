import type { MigrationRunnerFailure } from '@internal/framework-components/control';
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
 * A failed `db update` apply as the CLI reports it. `planFrom` is what a `migration plan` for this
 * database passes to `--from`, or `undefined` when no plan can start where the database is.
 */
export function dbUpdateRunnerFailureError(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  context: {
    readonly planFrom: string | undefined;
    readonly invocation: CliInvocation;
  },
): CliStructuredError {
  const { planFrom, invocation } = context;
  const update = dbUpdateRerun(invocation);
  const { blockingObjects } = failure.meta;
  const advice =
    blockingObjects !== undefined
      ? blockingObjectsAdvice(blockingObjects, update)
      : facts.failedTypeChange !== undefined
        ? dbUpdateFailedTypeChangeAdvice(facts.failedTypeChange, planFrom, invocation)
        : facts.rowsWithoutValue !== undefined
          ? dbUpdateRowsWithoutValueAdvice(facts.rowsWithoutValue, planFrom, invocation)
          : facts.rowsHoldingValue !== undefined
            ? dbUpdateRowsHoldingValueAdvice(facts.rowsHoldingValue, planFrom, invocation)
            : facts.rowsFailingCheck !== undefined
              ? dbUpdateRowsFailingCheckAdvice(facts.rowsFailingCheck, planFrom, invocation)
              : schemaCheckIssues(failure) !== undefined
                ? [
                    editFileAction(
                      `Change the contract source to resolve the issues listed, re-run \`${cliCommand(invocation, 'contract emit')}\`, then re-run \`${update}\``,
                    ),
                  ]
                : [chooseAction(`Resolve the cause the failure names, then re-run \`${update}\``)];
  return runnerFailureError(failure, advice);
}
