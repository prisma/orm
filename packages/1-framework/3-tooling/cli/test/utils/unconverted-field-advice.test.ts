import { describe, expect, it } from 'vitest';
import { dbUpdateError, migrateError } from './runner-failure-errors';

const runnerFailed = {
  summary: 'Operation alterType.user.age failed during execution: alter type of "age"',
  why: 'invalid input syntax for type integer: "abc"',
} as const;

const FROM = 'a'.repeat(64);
const PROJECT = '/work/app';
const FROM_PROJECT = { cwd: PROJECT, configPath: undefined, dbGiven: false };

describe('the advice for a type change whose cast failed', () => {
  it('points db update to a migration with --convert, from the contract the database is at', () => {
    expect(
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' },
          databaseStorageHash: FROM,
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      `A value of field "User.age" cannot be converted to its new type by the database's cast. Plan the change with \`{bin} migration plan --from ${FROM} --convert User.age\`, write the conversion in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and apply it with \`{bin} db migrate\`.`,
    );
  });

  it('points db migrate to writing a conversion in the failed migration, or to planning it again from its origin with --convert', () => {
    expect(
      migrateError(
        {
          ...runnerFailed,
          failedTypeChange: { field: 'My Model.age', by: 'cast', reason: 'value' },
          failedMigration: {
            directory: `${PROJECT}/migrations/app/20261012T1041_lossy`,
            from: FROM,
          },
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      `A value of field "My Model.age" cannot be converted to its new type by the database's cast. \`migrations/app/20261012T1041_lossy/migration.ts\` has no conversion for field "My Model.age": write one there, run \`node migrations/app/20261012T1041_lossy/migration.ts\`, and re-run \`{bin} db migrate\`. Or: Delete \`migrations/app/20261012T1041_lossy\` (copy any code you wrote in its migration.ts first), plan it again with \`{bin} migration plan --from ${FROM} --name lossy --convert 'My Model.age'\`, adding any other statements you planned it with except any \`--delete 'My Model.age'\`, fill in the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`{bin} db migrate\`.`,
    );
  });

  it('says the database has no cast between the types when it has none', () => {
    expect([
      dbUpdateError(
        {
          ...runnerFailed,
          conflicts: undefined,
          failedTypeChange: { field: 'T.d', by: 'cast', reason: 'noCast' },
        },
        FROM_PROJECT,
      ).fix,
      migrateError(
        { ...runnerFailed, failedTypeChange: { field: 'T.d', by: 'cast', reason: 'noCast' } },
        FROM_PROJECT,
      ).fix,
    ]).toEqual([
      expect.stringMatching(
        /^The database has no cast from the old type of field "T\.d" to its new type\. Plan the change with `\{bin\} migration plan --convert T\.d`/,
      ),
      expect.stringMatching(
        /^The database has no cast from the old type of field "T\.d" to its new type\. Plan the type change again with `\{bin\} migration plan --convert T\.d`/,
      ),
    ]);
  });

  it('points db migrate to the conversion in the failed migration when the conversion left a value the new type cannot hold', () => {
    expect(
      migrateError(
        {
          ...runnerFailed,
          failedTypeChange: { field: 'User.age', by: 'conversion', reason: 'invalidResult' },
          failedMigration: {
            directory: `${PROJECT}/migrations/app/20261012T1041_age`,
            from: FROM,
          },
        },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      'The conversion of field "User.age" left a value its new type cannot hold. Fix the conversion in `migrations/app/20261012T1041_age/migration.ts`, run `node migrations/app/20261012T1041_age/migration.ts`, and re-run `{bin} db migrate`.',
    );
  });

  it('says to run the migration.ts with node before db migrate when the failed migration is unknown', () => {
    expect(
      migrateError(
        { ...runnerFailed, failedTypeChange: { field: 'T.d', by: 'cast', reason: 'noCast' } },
        FROM_PROJECT,
      ).fix,
    ).toBe(
      'The database has no cast from the old type of field "T.d" to its new type. Plan the type change again with `{bin} migration plan --convert T.d`, write the conversion in the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and apply it with `{bin} db migrate`.',
    );
  });

  it('says whether the conversion failed on a value, left one, or has an error in its expression', () => {
    const advice = (reason: 'value' | 'invalidResult' | 'expressionError') =>
      migrateError(
        {
          ...runnerFailed,
          failedTypeChange: { field: 'User.age', by: 'conversion', reason },
          failedMigration: { directory: `${PROJECT}/migrations/app/20261012T1041_age`, from: FROM },
        },
        { cwd: PROJECT, configPath: 'prisma.config.ts', dbGiven: true },
      ).fix;
    const rest =
      ' Fix the conversion in `migrations/app/20261012T1041_age/migration.ts`, run `node migrations/app/20261012T1041_age/migration.ts --config prisma.config.ts`, and re-run `{bin} db migrate --config prisma.config.ts --db <url>`.';
    expect([advice('value'), advice('invalidResult'), advice('expressionError')]).toEqual([
      `The conversion of field "User.age" failed on a value its new type cannot hold.${rest}`,
      `The conversion of field "User.age" left a value its new type cannot hold.${rest}`,
      `The conversion of field "User.age" failed with an error in its expression.${rest}`,
    ]);
  });

  it('keeps the general advice for any other runner failure', () => {
    expect([
      dbUpdateError({ ...runnerFailed, conflicts: undefined }, FROM_PROJECT).fix,
      migrateError(runnerFailed, FROM_PROJECT).fix,
    ]).toEqual([
      'Inspect the reported conflict, reconcile schema drift if needed, then re-run `{bin} db update`.',
      'Fix the issue and re-run `{bin} db migrate --to <contract>`.',
    ]);
  });

  it('repeats --config and --db in the general advice', () => {
    const invocation = { cwd: '/work', configPath: 'app/prisma.config.ts', dbGiven: true };
    expect([
      dbUpdateError({ ...runnerFailed, conflicts: undefined }, invocation).fix,
      migrateError(runnerFailed, invocation).fix,
    ]).toEqual([
      'Inspect the reported conflict, reconcile schema drift if needed, then re-run `{bin} db update --config app/prisma.config.ts --db <url>`.',
      'Fix the issue and re-run `{bin} db migrate --to <contract> --config app/prisma.config.ts --db <url>`.',
    ]);
  });
});
