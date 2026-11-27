import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import { docsUrlFor } from '@internal/utils/structured-error';
import { ActionableCliError, type CliStructuredError } from './cli-errors';
import { chooseAction } from './next-actions';

/**
 * A failure of the migrations of the target's `_prisma` contract space, which every command that changes a database applies first. Those migrations are Prisma's, so none of the advice for a user's own migration fits; their checks are written for the user, so the runner's why, which quotes the failed check, is the explanation.
 */
export function prismaTablesRunnerFailureError(
  failure: MigrationRunnerFailure,
): CliStructuredError {
  const state =
    failure.meta.databaseUnchanged === false
      ? 'The operations that ran before the failure stay applied.'
      : 'The database is unchanged.';
  const next =
    failure.meta.failedCheck === undefined
      ? 'stopped there; correct the cause above and run the command again.'
      : 'stopped at the check above, whose text says what to do; then run the command again.';
  const fix = `${state} Prisma brings its own tables up to date before anything else, and ${next}`;
  return new ActionableCliError(
    failure.code,
    "Prisma's own tables in this database could not be brought up to date",
    {
      why: failure.why ?? failure.message,
      fix,
      nextActions: [chooseAction(fix)],
      meta: failure.meta,
      docsUrl: docsUrlFor(failure.code),
      cause: failure,
    },
  );
}
