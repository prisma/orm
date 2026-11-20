import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import type { RunnerFailureFacts } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import type { CliInvocation } from './printed-command';
import { type FailedMigrationOnDisk, migrateAdvice } from './runner-failure-advice';
import { runnerFailureError } from './runner-failure-error';

/**
 * A failed `db migrate` apply as the CLI reports it; its advice prints paths and commands that work
 * from where the CLI ran, with the `--config` it was given.
 */
export function migrateRunnerFailureError(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  failedMigration: FailedMigrationOnDisk | undefined,
  invocation: CliInvocation,
): CliStructuredError {
  return runnerFailureError(failure, migrateAdvice(failure, facts, failedMigration, invocation));
}
