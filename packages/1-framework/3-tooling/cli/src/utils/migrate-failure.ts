import { ifDefined } from '@internal/utils/defined';
import type { MigrateFailure } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { errorPathUnreachable, errorRunnerFailed } from './cli-errors';
import { failedPrecheckWhy } from './failed-precheck-advice';
import type { CliInvocation } from './printed-command';
import { migrateFix } from './runner-failure-advice';
import { runnerSchemaCheckWhy } from './schema-issues';

/**
 * A `migrate` apply failure as the CLI's structured error; its advice prints paths and commands
 * that work from where the CLI ran, with the `--config` it was given.
 */
export function mapMigrateFailure(
  failure: MigrateFailure,
  invocation: CliInvocation,
): CliStructuredError {
  if (failure.code === 'MIGRATION_PATH_NOT_FOUND') {
    return errorPathUnreachable(failure);
  }
  return errorRunnerFailed(failure.summary, {
    why:
      runnerSchemaCheckWhy(failure.meta) ??
      failure.why ??
      (failure.failedPrecheck === undefined
        ? 'Migration runner failed'
        : failedPrecheckWhy(failure.failedPrecheck)),
    fix: migrateFix(failure, invocation),
    meta: failure.meta ?? {},
    ...ifDefined('cause', failure.cause),
  });
}
