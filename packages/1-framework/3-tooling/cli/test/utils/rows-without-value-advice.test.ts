import { describe, expect, it } from 'vitest';
import { dbInitError, dbUpdateError, migrateError } from './runner-failure-errors';

const runnerFailed = {
  summary: '3 rows of "Item" hold NULL in "note", so it cannot become required.',
  why: 'Operation alterNullability.setNotNull.Item.note failed during precheck: ensure no NULL values in "note"',
} as const;

const DATABASE = 'a'.repeat(64);
const FROM = 'b'.repeat(64);
const PROJECT = '/work/app';
const FROM_PROJECT = { cwd: PROJECT, configPath: undefined, dbGiven: false };
const failedMigration = { directory: `${PROJECT}/migrations/app/20261012T1200_note`, from: FROM };

describe('the advice for rows a required field has no value for', () => {
  it('on db update, says to set the values, keep the field optional, or plan a backfill from the database contract', () => {
    expect(
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
          databaseStorageHash: DATABASE,
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      `Set a value in those 3 rows. Or: Keep the field optional in the contract source. Or: Plan it with \`{bin} migration plan --from ${DATABASE} --backfill Item.note\`, fill the backfill steps in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with \`{bin} db migrate\`.`,
    );
  });

  it('on db update, names a backfill for every field of the plan that needs one, each once', () => {
    expect(
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [
            { field: 'My Model.code', reason: 'newField', rows: 3 },
            { field: 'My Model.role', reason: 'newField', rows: 3 },
            { field: 'My Model.code', reason: 'newField', rows: 3 },
            { field: undefined, reason: 'nullValues', rows: 3 },
          ],
          databaseStorageHash: DATABASE,
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      `Plan it with \`{bin} migration plan --from ${DATABASE} --backfill 'My Model.code' --backfill 'My Model.role'\`, fill the backfill steps in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with \`{bin} db migrate\`. Or: Make the field optional in the contract source.`,
    );
  });

  it('suggests no backfill when the contract names no field', () => {
    expect([
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: undefined, reason: 'nullValues', rows: 3 }],
        },
        FROM_PROJECT,
      ).fix,
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: undefined, reason: 'newField', rows: 3 }],
        },
        FROM_PROJECT,
      ).fix,
    ]).toEqual([
      'Set a value in those 3 rows. Or: Keep the field optional in the contract source.',
      'Make the field optional in the contract source.',
    ]);
  });

  it('on db init, says to initialize with the field optional and make it required with db update', () => {
    expect(
      dbInitError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.code', reason: 'newField', rows: 3 }],
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      'Make field "Item.code" optional in the contract source, run `{bin} db init`, then make it required with `{bin} db update`, which says how to give the rows a value.',
    );
  });

  it('on db migrate, keeps the statements of the failed migration and adds a backfill for every field that needs one', () => {
    const rowsWithoutValue = [
      { field: 'Item.role', reason: 'newField', rows: 3 },
      { field: 'Item.code', reason: 'newField', rows: 3 },
    ] as const;
    const replan = `\`migrations/app/20261012T1200_note\` (copy any code you wrote in its migration.ts first), plan it again with \`{bin} migration plan --from ${FROM} --name note --backfill Item.role --backfill Item.code\`, adding any other statements you planned it with, fill in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`{bin} db migrate\``;
    expect([
      migrateError({ ...runnerFailed, rowsWithoutValue, failedMigration }, FROM_PROJECT).fix,
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [
            { field: 'Item.role', reason: 'nullValues', rows: 3 },
            rowsWithoutValue[1],
          ],
          failedMigration,
        },
        FROM_PROJECT,
      ).fix,
    ]).toEqual([
      `To keep the field required, delete ${replan}. Or: Make the field optional in the contract source, and plan it again.`,
      `The migration also adds a required field the existing rows have no value for, so setting values is not enough. Delete ${replan}.`,
    ]);
    expect(
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [
            { field: 'Item.note', reason: 'nullValues', rows: 3 },
            { field: 'Item.nick', reason: 'nullValues', rows: 3 },
          ],
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      'Set a value in the rows that hold NULL in each of "Item.note", "Item.nick" and re-run `{bin} db migrate`. Or: Keep those fields optional in the contract source, and plan the migration again.',
    );
  });

  it('on db migrate, offers keeping a field with NULL rows optional, as db update does', () => {
    expect(
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
          failedMigration,
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      `Set a value in those 3 rows and re-run \`{bin} db migrate\`. Or: Delete \`migrations/app/20261012T1200_note\` (copy any code you wrote in its migration.ts first), plan it again with \`{bin} migration plan --from ${FROM} --name note --backfill Item.note\`, adding any other statements you planned it with, fill in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`{bin} db migrate\`. Or: Keep the field optional: make it optional in the contract source again, delete \`migrations/app/20261012T1200_note\` (copy any code you wrote in its migration.ts first), and plan it again with \`{bin} migration plan --from ${FROM} --name note\`, adding any other statements you planned it with, put back any code you copied, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with \`{bin} db migrate\`.`,
    );
  });

  it('on db migrate, gives each way out its own next action', () => {
    const error = migrateError(
      {
        ...runnerFailed,
        rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
        failedMigration,
      },
      FROM_PROJECT,
    );
    expect(error.nextActions?.map(({ kind, command }) => ({ kind, command }))).toEqual([
      { kind: 'user-choice', command: undefined },
      { kind: 'user-choice', command: undefined },
      { kind: 'edit-file', command: undefined },
    ]);
    expect(error.nextActions?.[0]?.label).toBe(
      'Set a value in those 3 rows and re-run `{bin} db migrate`',
    );
  });

  it('never says a migration is planned again with "its other statements", which the CLI does not store', () => {
    const fixes = (
      [
        [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
        [{ field: 'Item.code', reason: 'newField', rows: 3 }],
        [
          { field: 'Item.note', reason: 'nullValues', rows: 3 },
          { field: 'Item.code', reason: 'newField', rows: 3 },
        ],
      ] as const
    ).map(
      (rowsWithoutValue) =>
        migrateError({ ...runnerFailed, rowsWithoutValue, failedMigration }, FROM_PROJECT).fix,
    );
    expect(fixes.filter((fix) => fix?.includes('its other statements'))).toEqual([]);
  });

  it('on db migrate from another directory with --config, prints every path and command so it works from there', () => {
    expect(
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
          failedMigration,
        },
        { cwd: '/work', configPath: 'app/prisma.config.ts', dbGiven: false },
      ).fix,
    ).toBe(
      `Set a value in those 3 rows and re-run \`{bin} db migrate --config app/prisma.config.ts\`. Or: Delete \`app/migrations/app/20261012T1200_note\` (copy any code you wrote in its migration.ts first), plan it again with \`{bin} migration plan --from ${FROM} --name note --backfill Item.note --config app/prisma.config.ts\`, adding any other statements you planned it with, fill in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`{bin} db migrate --config app/prisma.config.ts\`. Or: Keep the field optional: make it optional in the contract source again, delete \`app/migrations/app/20261012T1200_note\` (copy any code you wrote in its migration.ts first), and plan it again with \`{bin} migration plan --from ${FROM} --name note --config app/prisma.config.ts\`, adding any other statements you planned it with, put back any code you copied, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with \`{bin} db migrate --config app/prisma.config.ts\`.`,
    );
  });

  it('on db update and db init with --config, repeats it in every command', () => {
    const withConfig = { cwd: '/work', configPath: 'app/prisma.config.ts', dbGiven: false };
    expect([
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'newField', rows: 3 }],
        },
        withConfig,
      ).fix,
      dbInitError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
        },
        withConfig,
      ).fix,
    ]).toEqual([
      'Plan it with `{bin} migration plan --backfill Item.note --config app/prisma.config.ts`, fill the backfill steps in the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and apply it with `{bin} db migrate --config app/prisma.config.ts`. Or: Make the field optional in the contract source.',
      'Make field "Item.note" optional in the contract source, run `{bin} db init --config app/prisma.config.ts`, then make it required with `{bin} db update --config app/prisma.config.ts`, which says how to give the rows a value.',
    ]);
  });

  it('on db migrate, says the backfill step left the rows without a value and to fix the step, not to plan again', () => {
    const advice = (failed: typeof failedMigration | undefined) =>
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'backfillMissedRows', rows: 3 }],
          ...(failed === undefined ? {} : { failedMigration: failed }),
        },
        { cwd: '/work', configPath: 'app/prisma.config.ts', dbGiven: false },
      ).fix;
    expect([advice(failedMigration), advice(undefined)]).toEqual([
      'The backfill step of field "Item.note" left those rows without a value. Make its run fill every row in `app/migrations/app/20261012T1200_note/migration.ts`, run `node app/migrations/app/20261012T1200_note/migration.ts --config app/prisma.config.ts`, and re-run `{bin} db migrate --config app/prisma.config.ts`.',
      'The backfill step of field "Item.note" left those rows without a value. Make its run fill every row in the migration.ts of the failed migration, run that file with node, and re-run `{bin} db migrate --config app/prisma.config.ts`.',
    ]);
  });

  it('with --db, repeats it as a placeholder in every command that connects, so the advice applies to the same database', () => {
    const withDb = { cwd: '/work', configPath: 'app/prisma.config.ts', dbGiven: true };
    expect([
      migrateError(
        {
          ...runnerFailed,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'backfillMissedRows', rows: 3 }],
        },
        withDb,
      ).fix,
      migrateError(runnerFailed, withDb).fix,
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'newField', rows: 3 }],
        },
        withDb,
      ).fix,
    ]).toEqual([
      'The backfill step of field "Item.note" left those rows without a value. Make its run fill every row in the migration.ts of the failed migration, run that file with node, and re-run `{bin} db migrate --config app/prisma.config.ts --db <url>`.',
      'Fix the issue and re-run `{bin} db migrate --to <contract> --config app/prisma.config.ts --db <url>`.',
      'Plan it with `{bin} migration plan --backfill Item.note --config app/prisma.config.ts`, fill the backfill steps in the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and apply it with `{bin} db migrate --config app/prisma.config.ts --db <url>`. Or: Make the field optional in the contract source.',
    ]);
  });

  it('never mentions schema drift', () => {
    expect(
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
        },
        FROM_PROJECT,
      ).fix,
    ).not.toContain('drift');
  });

  it('wins over the precheck advice when the failed precheck is the one that found the rows, on every command', () => {
    const rows = {
      ...runnerFailed,
      rowsWithoutValue: [{ field: 'Item.note', reason: 'nullValues', rows: 3 }],
      databaseStorageHash: DATABASE,
      failedMigration,
    } as const;
    const withPrecheck = {
      ...rows,
      failedPrecheck: {
        operationId: 'alterNullability.setNotNull.Item.note',
        description: 'ensure no NULL values in "note"',
        planStartsFromMarker: true,
      },
    };
    expect(
      [dbInitError, dbUpdateError, migrateError].map(
        (error) => error(withPrecheck, FROM_PROJECT).fix,
      ),
    ).toEqual(
      [dbInitError, dbUpdateError, migrateError].map((error) => error(rows, FROM_PROJECT).fix),
    );
  });

  it('says "that row" when one row has no value', () => {
    const rowsWithoutValue = [{ field: 'Item.note', reason: 'nullValues', rows: 1 }] as const;
    expect([
      dbUpdateError({ ...runnerFailed, conflicts: undefined, rowsWithoutValue }, FROM_PROJECT)
        .nextActions?.[0]?.label,
      migrateError({ ...runnerFailed, rowsWithoutValue }, FROM_PROJECT).nextActions?.[0]?.label,
    ]).toEqual([
      'Set a value in that row',
      'Set a value in that row and re-run `{bin} db migrate`',
    ]);
  });
});
