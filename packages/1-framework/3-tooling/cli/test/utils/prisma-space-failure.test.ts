import { APP_UPGRADE_GUIDES_URL } from '@internal/errors/control';
import {
  type MigrationRunnerFailure,
  migrationRunnerFailure,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { prismaSpaceRunnerFailureError } from '../../src/utils/prisma-space-failure';

const ownershipCheck =
  'The role that runs this command must have the privileges of the role that owns schema "prisma_contract", because renaming a schema needs them.';

function failedPrecheck(databaseUnchanged: boolean): MigrationRunnerFailure {
  return migrationRunnerFailure(
    'MIGRATION.PRECHECK_FAILED',
    `Operation _prisma.rename-release-candidate-schema failed during precheck: ${ownershipCheck}`,
    {
      why: `Before operation _prisma.rename-release-candidate-schema runs, it checks: ${ownershipCheck}. That check failed on this database.`,
      meta: {
        failingSpace: '_prisma',
        databaseUnchanged,
        failedCheck: {
          operationId: '_prisma.rename-release-candidate-schema',
          phase: 'precheck',
          description: ownershipCheck,
        },
      },
    },
  );
}

describe('prismaSpaceRunnerFailureError', () => {
  it("explains a failed check of the _prisma space's migration by the check's own text, without the runner's operation id or the advice for a user's migration", () => {
    const error = prismaSpaceRunnerFailureError(failedPrecheck(true));

    expect({
      code: error.code,
      message: error.message,
      why: error.why,
      fix: error.fix,
      nextActions: error.nextActions,
      meta: error.meta,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'The records Prisma keeps for itself in this database could not be brought up to date',
      why: ownershipCheck,
      fix: `The database is unchanged. Prisma brings the records it keeps for itself up to date before anything else, and stopped because this database does not meet the requirement above, which says what the database, or the role that runs the command, must be. The upgrade instructions at ${APP_UPGRADE_GUIDES_URL} say how to meet it; follow them, then run the command again.`,
      nextActions: [
        { kind: 'open-url', label: 'Follow the upgrade instructions', url: APP_UPGRADE_GUIDES_URL },
      ],
      meta: failedPrecheck(true).meta,
    });
  });

  it('says what stays applied when the target could not roll the failure back', () => {
    expect(prismaSpaceRunnerFailureError(failedPrecheck(false)).fix).toBe(
      `The operations that ran before the failure stay applied. Prisma brings the records it keeps for itself up to date before anything else, and stopped because this database does not meet the requirement above, which says what the database, or the role that runs the command, must be. The upgrade instructions at ${APP_UPGRADE_GUIDES_URL} say how to meet it; follow them, then run the command again.`,
    );
  });

  it('names no check when none failed', () => {
    const failure = migrationRunnerFailure(
      'MIGRATION.EXECUTION_FAILED',
      'permission denied for database',
      { meta: { failingSpace: '_prisma', databaseUnchanged: true } },
    );

    expect(prismaSpaceRunnerFailureError(failure)).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'The records Prisma keeps for itself in this database could not be brought up to date',
      why: 'permission denied for database',
      fix: 'The database is unchanged. Prisma brings the records it keeps for itself up to date before anything else, and stopped there; correct the cause above and run the command again.',
    });
  });
});
