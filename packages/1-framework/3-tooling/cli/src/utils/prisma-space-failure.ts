import { APP_UPGRADE_GUIDES_URL } from '@internal/errors/control';
import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import { docsUrlFor } from '@internal/utils/structured-error';
import { ActionableCliError, type CliStructuredError } from './cli-errors';
import { chooseAction } from './next-actions';

/**
 * A failure of the migrations of the Prisma space, which every command that changes a database applies first. Those migrations are Prisma's, so none of the advice for a user's own migration fits; their checks are written for the user, so the runner's why, which quotes the failed check, is the explanation.
 */
export function prismaSpaceRunnerFailureError(failure: MigrationRunnerFailure): CliStructuredError {
  const state =
    failure.meta.databaseUnchanged === false
      ? 'The operations that ran before the failure stay applied.'
      : 'The database is unchanged.';
  const failedCheck = failure.meta.failedCheck !== undefined;
  const next = failedCheck
    ? `stopped at the check above. The upgrade instructions at ${APP_UPGRADE_GUIDES_URL} say what to do when one of these checks fails; follow them, then run the command again.`
    : 'stopped there; correct the cause above and run the command again.';
  const fix = `${state} Prisma brings its own tables up to date before anything else, and ${next}`;
  return new ActionableCliError(
    failure.code,
    "Prisma's own tables in this database could not be brought up to date",
    {
      why: failure.why ?? failure.message,
      fix,
      nextActions: [
        failedCheck
          ? {
              kind: 'open-url',
              label: 'Follow the upgrade instructions',
              url: APP_UPGRADE_GUIDES_URL,
            }
          : chooseAction(fix),
      ],
      meta: failure.meta,
      docsUrl: docsUrlFor(failure.code),
      cause: failure,
    },
  );
}
