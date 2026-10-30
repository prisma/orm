import { migrationRunnerFailure } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const FROM = 'sha256:0123';
const WITH_STATEMENTS = {
  ...PROJECT,
  statementArgs: ['--rename Prio.High:Prio.Higher', '--delete Status.ARCHIVED'],
};

const failure = migrationRunnerFailure(
  'MIGRATION.PRECHECK_FAILED',
  '2 rows of "task" hold "archived" in column "status", which takes no NULL, so enum value "Status.ARCHIVED" cannot be removed.',
  {
    why: 'Operation removeStoredValue.task.status.archived failed during precheck: ensure column "status" of "task" takes NULL, or no row holds "archived" in it',
    meta: {
      failedCheck: {
        operationId: 'removeStoredValue.task.status.archived',
        phase: 'precheck',
        description:
          'ensure column "status" of "task" takes NULL, or no row holds "archived" in it',
      },
      databaseUnchanged: true,
    },
  },
);

const keepDataEdit = {
  remove: 'this.removeStoredValue({ table: "task", column: "status", value: "archived" })',
  replaceWith:
    'this.replaceStoredValue({ table: "task", column: "status", from: "archived", to: "<stored value>" })',
};
const rowsHoldingValue = {
  enumValue: 'Status.ARCHIVED',
  enumName: 'Status',
  value: 'archived',
  rows: 2,
  keepDataEdit,
} as const;

function labels(error: { readonly nextActions?: readonly { readonly label: string }[] }) {
  return (error.nextActions ?? []).map(({ label }) => label);
}

describe('the advice when a removed enum value is still held by rows of a required column', () => {
  it('on db update, says to rename the value, or to keep the rows by hand through migration plan, with the run statements', () => {
    const error = dbUpdateRunnerFailureError(
      failure,
      {
        rowsHoldingValue: [rowsHoldingValue],
        failedPrecheck: {
          operationId: 'removeStoredValue.task.status.archived',
          description:
            'ensure column "status" of "task" takes NULL, or no row holds "archived" in it',
          planStartsFromMarker: false,
        },
      },
      { databaseStorageHash: FROM, invocation: WITH_STATEMENTS },
    );

    expect(labels(error)).toEqual([
      'To keep that data under a new enum value, add a member to enum "Status" in the contract source, run `{bin} contract emit`, then run `{bin} db update --rename Prio.High:Prio.Higher --rename \'Status.ARCHIVED:Status.<new member>\'`',
      'To keep that data by hand, plan the change with `{bin} migration plan --from sha256:0123 --rename Prio.High:Prio.Higher --delete Status.ARCHIVED`, replace this.removeStoredValue({ table: "task", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "task", column: "status", from: "archived", to: "<stored value>" }) in the migration.ts it writes, where "<stored value>" is a stored value the enum keeps, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
    ]);
  });

  it('on db update with no migration at the database contract, says to change the rows in the database instead', () => {
    const error = dbUpdateRunnerFailureError(
      failure,
      { rowsHoldingValue: [rowsHoldingValue] },
      { databaseStorageHash: undefined, invocation: WITH_STATEMENTS },
    );

    expect(labels(error)[1]).toBe(
      'To keep that data under another stored value, change the stored value "archived" to one the enum keeps in the database yourself, then re-run `{bin} db update --rename Prio.High:Prio.Higher --delete Status.ARCHIVED`',
    );
  });

  it('on db migrate, says to plan the migration again with a rename, or to change the migration.ts', () => {
    const error = migrateRunnerFailureError(
      failure,
      {
        rowsHoldingValue: [rowsHoldingValue],
        failedPrecheck: {
          operationId: 'removeStoredValue.task.status.archived',
          description:
            'ensure column "status" of "task" takes NULL, or no row holds "archived" in it',
          planStartsFromMarker: true,
        },
      },
      { directory: '/work/app/migrations/app/20260101T0000_retire', from: FROM },
      PROJECT,
    );

    expect(labels(error)).toEqual([
      'To keep that data under a new enum value, add a member to enum "Status" in the contract source, run `{bin} contract emit`, delete `migrations/app/20260101T0000_retire` (copy any code you wrote in its migration.ts first), plan it again with `{bin} migration plan --from sha256:0123 --name retire --rename \'Status.ARCHIVED:Status.<new member>\'`, adding any other statements you planned it with except any `--delete Status.ARCHIVED`, put any code you copied into the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
      'To keep that data by hand, replace this.removeStoredValue({ table: "task", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "task", column: "status", from: "archived", to: "<stored value>" }) in `migrations/app/20260101T0000_retire/migration.ts`, where "<stored value>" is a stored value the enum keeps, run `node migrations/app/20260101T0000_retire/migration.ts`, and re-run `{bin} db migrate`',
    ]);
    expect(JSON.stringify(error.nextActions)).not.toContain('drifted');
  });

  it('leaves out the action by hand when the target gives no edit', () => {
    const { keepDataEdit: _edit, ...withoutEdit } = rowsHoldingValue;
    const error = migrateRunnerFailureError(
      failure,
      { rowsHoldingValue: [withoutEdit] },
      { directory: '/work/app/migrations/app/20260101T0000_retire', from: FROM },
      PROJECT,
    );

    expect(labels(error)).toHaveLength(1);
    expect(JSON.stringify(error.nextActions)).not.toMatch(/rows|removeStoredValue/);
  });

  describe('when several required columns hold removed values', () => {
    const projectEdit = {
      remove: 'this.removeStoredValue({ table: "project", column: "status", value: "archived" })',
      replaceWith:
        'this.replaceStoredValue({ table: "project", column: "status", from: "archived", to: "<stored value>" })',
    };
    const several = [
      rowsHoldingValue,
      { ...rowsHoldingValue, rows: 3, keepDataEdit: projectEdit },
      {
        enumValue: 'Prio.Low',
        enumName: 'Prio',
        value: 1,
        rows: 1,
        keepDataEdit: {
          remove: 'this.removeStoredValue({ table: "task", column: "prio", value: 1 })',
          replaceWith:
            'this.replaceStoredValue({ table: "task", column: "prio", from: 1, to: "<stored value>" })',
        },
      },
    ];

    it('on db update, renames each value once and keeps every column by hand in one plan', () => {
      const error = dbUpdateRunnerFailureError(
        failure,
        { rowsHoldingValue: several },
        {
          databaseStorageHash: FROM,
          invocation: {
            ...PROJECT,
            statementArgs: ['--delete Status.ARCHIVED', '--delete Prio.Low'],
          },
        },
      );

      expect(labels(error)).toEqual([
        'To keep that data under a new enum value, add a member to each of enums "Status", "Prio" in the contract source, run `{bin} contract emit`, then run `{bin} db update --rename \'Status.ARCHIVED:Status.<new member>\' --rename \'Prio.Low:Prio.<new member>\'`',
        'To keep that data by hand, plan the change with `{bin} migration plan --from sha256:0123 --delete Status.ARCHIVED --delete Prio.Low`, replace this.removeStoredValue({ table: "task", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "task", column: "status", from: "archived", to: "<stored value>" }), replace this.removeStoredValue({ table: "project", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "project", column: "status", from: "archived", to: "<stored value>" }), and replace this.removeStoredValue({ table: "task", column: "prio", value: 1 }) with this.replaceStoredValue({ table: "task", column: "prio", from: 1, to: "<stored value>" }) in the migration.ts it writes, where "<stored value>" is a stored value the enum keeps, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
      ]);
    });

    it('on db update with no migration at the database contract, names each stored value to change', () => {
      const error = dbUpdateRunnerFailureError(
        failure,
        { rowsHoldingValue: several },
        { databaseStorageHash: undefined, invocation: PROJECT },
      );

      expect(labels(error)[1]).toBe(
        'To keep that data under another stored value, change each of the stored values "archived", 1 to one its enum keeps in the database yourself, then re-run `{bin} db update --delete Status.ARCHIVED --delete Prio.Low`',
      );
    });

    it('on db migrate, plans again with a rename of each value and lists every edit by hand', () => {
      const error = migrateRunnerFailureError(
        failure,
        { rowsHoldingValue: several },
        { directory: '/work/app/migrations/app/20260101T0000_retire', from: FROM },
        PROJECT,
      );

      expect(labels(error)).toEqual([
        'To keep that data under a new enum value, add a member to each of enums "Status", "Prio" in the contract source, run `{bin} contract emit`, delete `migrations/app/20260101T0000_retire` (copy any code you wrote in its migration.ts first), plan it again with `{bin} migration plan --from sha256:0123 --name retire --rename \'Status.ARCHIVED:Status.<new member>\' --rename \'Prio.Low:Prio.<new member>\'`, adding any other statements you planned it with except any `--delete Status.ARCHIVED` or `--delete Prio.Low`, put any code you copied into the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
        'To keep that data by hand, replace this.removeStoredValue({ table: "task", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "task", column: "status", from: "archived", to: "<stored value>" }), replace this.removeStoredValue({ table: "project", column: "status", value: "archived" }) with this.replaceStoredValue({ table: "project", column: "status", from: "archived", to: "<stored value>" }), and replace this.removeStoredValue({ table: "task", column: "prio", value: 1 }) with this.replaceStoredValue({ table: "task", column: "prio", from: 1, to: "<stored value>" }) in `migrations/app/20260101T0000_retire/migration.ts`, where "<stored value>" is a stored value the enum keeps, run `node migrations/app/20260101T0000_retire/migration.ts`, and re-run `{bin} db migrate`',
      ]);
    });
  });
});
