import { migrationRunnerFailure } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const FROM = 'sha256:0123';
const QUERY = `SELECT * FROM "public"."user" WHERE NOT ("address" IS NULL)`;

const failure = migrationRunnerFailure(
  'MIGRATION.EXECUTION_FAILED',
  'Rows of table "user" fail check "user_address_shape_5c02601b" on column "address", so the check cannot be added.',
  { why: `Find them with \`${QUERY}\`.`, meta: { databaseUnchanged: true } },
);

const replacing = {
  check: 'user_address_shape_5c02601b',
  replacedCheck: 'user_address_shape_9a7e984c',
} as const;

const { replacedCheck: _replaced, ...adding } = replacing;

function labels(error: { readonly nextActions?: readonly { readonly label: string }[] }) {
  return (error.nextActions ?? []).map(({ label }) => label);
}

describe('the advice when existing rows fail a check the apply adds', () => {
  it('on db migrate, says to update the rows in the failed migration between the drop of the old check and the add of the new one', () => {
    const error = migrateRunnerFailureError(
      failure,
      { rowsFailingCheck: replacing },
      { directory: '/work/app/migrations/app/20260101T0000_country', from: FROM },
      PROJECT,
    );

    expect(labels(error)).toEqual([
      'To keep the data, add an operation that updates those rows to fit check "user_address_shape_5c02601b" to `migrations/app/20260101T0000_country/migration.ts`, after the operation that drops check "user_address_shape_9a7e984c" and before the operation that adds check "user_address_shape_5c02601b", run `node migrations/app/20260101T0000_country/migration.ts`, and re-run `{bin} db migrate`',
    ]);
    expect(JSON.stringify(error.nextActions)).not.toContain('--to');
  });

  it('on db migrate, says to fix the rows first when the check replaces none, and to re-run with the same flags', () => {
    const error = migrateRunnerFailureError(
      failure,
      { rowsFailingCheck: adding },
      { directory: '/work/app/migrations/app/20260101T0000_country', from: FROM },
      { ...PROJECT, rerunArgs: ['--advance-ref', 'db'] },
    );

    expect(labels(error)).toEqual([
      'Update or delete those rows so they fit check "user_address_shape_5c02601b", then re-run `{bin} db migrate --advance-ref db`',
    ]);
  });

  it('on db update, says it cannot keep the data, and to plan the change with migration plan instead', () => {
    const error = dbUpdateRunnerFailureError(
      failure,
      { rowsFailingCheck: replacing },
      { databaseStorageHash: FROM, invocation: PROJECT },
    );

    expect(labels(error)).toEqual([
      '`{bin} db update` cannot keep this data. Plan the change with `{bin} migration plan --from sha256:0123`, add an operation that updates those rows to fit check "user_address_shape_5c02601b" to the migration.ts it writes, after the operation that drops check "user_address_shape_9a7e984c" and before the operation that adds check "user_address_shape_5c02601b", run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
    ]);
    expect(JSON.stringify(error.nextActions)).not.toContain('drift');
  });

  it('on db update with no migration at the database contract, says to drop the old check and fix the rows in the database', () => {
    const error = dbUpdateRunnerFailureError(
      failure,
      { rowsFailingCheck: replacing },
      { databaseStorageHash: undefined, invocation: PROJECT },
    );

    expect(labels(error)).toEqual([
      '`{bin} db update` cannot keep this data, and no migration ends at the contract the database is at, so `{bin} migration plan` cannot plan from it. Drop check "user_address_shape_9a7e984c" in the database yourself, update those rows to fit check "user_address_shape_5c02601b", then re-run `{bin} db update`',
    ]);
  });

  it('on db update, says to fix the rows first when the check replaces none', () => {
    const error = dbUpdateRunnerFailureError(
      failure,
      { rowsFailingCheck: adding },
      { databaseStorageHash: FROM, invocation: PROJECT },
    );

    expect(labels(error)).toEqual([
      'Update or delete those rows so they fit check "user_address_shape_5c02601b", then re-run `{bin} db update`',
    ]);
  });
});
