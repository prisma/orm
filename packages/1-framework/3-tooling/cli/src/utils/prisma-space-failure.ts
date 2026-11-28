import type { MigrationRunnerFailure } from '@internal/framework-components/control';
import { docsUrlFor } from '@internal/utils/structured-error';
import { APP_UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { ActionableCliError, type CliStructuredError } from './cli-errors';
import { chooseAction } from './next-actions';

/**
 * A failure of the migrations of the Prisma space, which every command that changes a database applies first. Those migrations are Prisma's, so none of the advice for a user's own migration fits. Each of their checks states a requirement for the user, so a failed check's description is the explanation.
 */
export function prismaSpaceRunnerFailureError(failure: MigrationRunnerFailure): CliStructuredError {
  const state =
    failure.meta.databaseUnchanged === false
      ? 'The operations that ran before the failure stay applied.'
      : 'The database is unchanged.';
  const { failedCheck } = failure.meta;
  const next =
    failedCheck !== undefined
      ? `stopped because this database does not meet the requirement above, which says what the database, or the role that runs the command, must be. The upgrade instructions at ${APP_UPGRADE_GUIDES_URL} say how to meet it; follow them, then run the command again.`
      : 'stopped there; correct the cause above and run the command again.';
  const fix = `${state} Prisma brings the records it keeps for itself up to date before anything else, and ${next}`;
  return new ActionableCliError(
    failure.code,
    'The records Prisma keeps for itself in this database could not be brought up to date',
    {
      why: failedCheck?.description ?? failure.why ?? failure.message,
      fix,
      nextActions: [
        failedCheck !== undefined
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
