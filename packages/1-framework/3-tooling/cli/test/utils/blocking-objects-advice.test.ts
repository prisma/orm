import { migrationRunnerFailure } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const blocked = migrationRunnerFailure(
  'MIGRATION.EXECUTION_FAILED',
  'Table "billing"."audit_log" cannot be dropped while view billing.v_paid depends on it.',
  { meta: { blockingObjects: [{ kind: 'view', name: 'billing.v_paid' }] } },
);

describe('the advice for an operation that objects in the database block', () => {
  it('on db update, says to drop or change the objects named, then run it again with its statements', () => {
    expect(
      dbUpdateRunnerFailureError(
        blocked,
        {},
        {
          databaseStorageHash: undefined,
          invocation: { ...PROJECT, rerunArgs: ['--delete', 'billing'] },
        },
      ).fix,
    ).toBe(
      'Drop or change view billing.v_paid in the database yourself, then re-run `{bin} db update --delete billing`.',
    );
  });

  it('on db migrate, says the same', () => {
    expect(migrateRunnerFailureError(blocked, {}, undefined, PROJECT).fix).toBe(
      'Drop or change view billing.v_paid in the database yourself, then re-run `{bin} db migrate`.',
    );
  });

  it('on db migrate, repeats the --to the run was given', () => {
    expect(
      migrateRunnerFailureError(blocked, {}, undefined, {
        ...PROJECT,
        rerunArgs: ['--to', 'c1a2b3'],
      }).fix,
    ).toBe(
      'Drop or change view billing.v_paid in the database yourself, then re-run `{bin} db migrate --to c1a2b3`.',
    );
  });
});
