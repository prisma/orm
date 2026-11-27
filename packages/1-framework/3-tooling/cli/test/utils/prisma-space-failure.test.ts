import {
  type MigrationRunnerFailure,
  migrationRunnerFailure,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { prismaSpaceRunnerFailureError } from '../../src/utils/prisma-space-failure';

const ownershipCheck =
  'ensure the current role may rename schema "prisma_contract": run the command as the role that owns it';

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
  it("reports a failed check of the _prisma space's migration by the check's own text, without the advice for a user's migration", () => {
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
      message: "Prisma's own tables in this database could not be brought up to date",
      why: failedPrecheck(true).why,
      fix: 'The database is unchanged. Prisma brings its own tables up to date before anything else, and stopped at the check above, whose text says what to do; then run the command again.',
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'The database is unchanged. Prisma brings its own tables up to date before anything else, and stopped at the check above, whose text says what to do; then run the command again.',
        },
      ],
      meta: failedPrecheck(true).meta,
    });
  });

  it('says what stays applied when the target could not roll the failure back', () => {
    expect(prismaSpaceRunnerFailureError(failedPrecheck(false)).fix).toBe(
      'The operations that ran before the failure stay applied. Prisma brings its own tables up to date before anything else, and stopped at the check above, whose text says what to do; then run the command again.',
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
      message: "Prisma's own tables in this database could not be brought up to date",
      why: 'permission denied for database',
      fix: 'The database is unchanged. Prisma brings its own tables up to date before anything else, and stopped there; correct the cause above and run the command again.',
    });
  });
});
