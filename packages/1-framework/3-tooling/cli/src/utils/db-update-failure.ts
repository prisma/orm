import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import type { RunnerFailureFacts } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { chooseAction, editFileAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';
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
 * A failed `db update` apply as the CLI reports it. `databaseStorageHash` is the contract the
 * database is at when a migration of the graph ends at it: the origin a `migration plan` for this
 * database starts from.
 */
export function dbUpdateRunnerFailureError(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  context: {
    readonly databaseStorageHash: string | undefined;
    readonly invocation: CliInvocation;
  },
): CliStructuredError {
  const { databaseStorageHash, invocation } = context;
  const update = cliCommand(invocation, 'db update');
  const { blockingObjects } = failure.meta;
  const advice =
    blockingObjects !== undefined
      ? blockingObjectsAdvice(
          blockingObjects,
          cliCommand(invocation, 'db update', invocation.rerunArgs ?? []),
        )
      : facts.failedTypeChange !== undefined
        ? dbUpdateFailedTypeChangeAdvice(facts.failedTypeChange, databaseStorageHash, invocation)
        : facts.rowsWithoutValue !== undefined
          ? dbUpdateRowsWithoutValueAdvice(facts.rowsWithoutValue, databaseStorageHash, invocation)
          : facts.rowsHoldingValue !== undefined
            ? dbUpdateRowsHoldingValueAdvice(
                facts.rowsHoldingValue,
                databaseStorageHash,
                invocation,
              )
            : facts.rowsFailingCheck !== undefined
              ? dbUpdateRowsFailingCheckAdvice(
                  facts.rowsFailingCheck,
                  databaseStorageHash,
                  invocation,
                )
              : schemaCheckIssues(failure) !== undefined
                ? [
                    editFileAction(
                      `Change the contract source to resolve the issues listed, re-run \`${cliCommand(invocation, 'contract emit')}\`, then re-run \`${update}\``,
                    ),
                  ]
                : [
                    chooseAction(
                      `Inspect the reported conflict, reconcile schema drift if needed, then re-run \`${update}\``,
                    ),
                  ];
  return runnerFailureError(failure, advice);
}
