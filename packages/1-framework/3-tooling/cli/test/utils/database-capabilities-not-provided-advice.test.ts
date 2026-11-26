import {
  type DatabaseCapabilitiesNotProvided,
  databaseCapabilitiesNotProvidedText,
  migrationRunnerFailure,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { dbInitRunnerFailureError } from '../../src/utils/db-init-failure';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';
import { originOf, toEmitted } from './plan-origins';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const notProvided: DatabaseCapabilitiesNotProvided = {
  database: 'PostgreSQL',
  findings: [{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }],
};
const text = databaseCapabilitiesNotProvidedText(notProvided);

const refused = migrationRunnerFailure('MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED', text, {
  meta: { databaseCapabilitiesNotProvided: notProvided, databaseUnchanged: true },
});

function reported(error: {
  readonly message: string;
  readonly fix?: string | undefined;
  readonly nextActions?: readonly unknown[] | undefined;
}) {
  return { message: error.message, fix: error.fix, nextActions: error.nextActions };
}

const refusalOnly = { message: text, fix: undefined, nextActions: [] };

describe('a runner that refuses a database that does not provide what the contract requires', () => {
  it('on db init, prints the refusal and no advice', () => {
    expect(reported(dbInitRunnerFailureError(refused, {}, PROJECT))).toEqual(refusalOnly);
  });

  it('on db update, prints the refusal and no advice', () => {
    expect(
      reported(
        dbUpdateRunnerFailureError(
          refused,
          {},
          { migrationPlan: toEmitted(originOf(undefined)), invocation: PROJECT },
        ),
      ),
    ).toEqual(refusalOnly);
  });

  it('on db migrate, prints the refusal and no advice', () => {
    expect(reported(migrateRunnerFailureError(refused, {}, undefined, PROJECT))).toEqual(
      refusalOnly,
    );
  });
});
