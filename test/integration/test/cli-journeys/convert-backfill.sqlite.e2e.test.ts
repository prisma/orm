/**
 * `--convert`, `--backfill` and the temporary value on SQLite, end to end on a table with rows:
 * `migration plan` writes the rebuild or the data transform, the user fills its slot, runs the
 * `migration.ts`, and `db migrate` applies it. A new required field in a key, or whose values come
 * from a value set, gets no temporary value: the rebuild applies to an empty table and fails on
 * `NOT NULL` when the table has rows. `cli.backfill-enum.sqlite.e2e.test.ts` fills such a field
 * through `--backfill` and reads it back through the ORM.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const BASE = `// use prisma-8

model User {
  id       Int     @id
  age      String
  nickname String?
}
`;

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setup(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), BASE, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function query(dbPath: string, sql: string): readonly Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function exec(dbPath: string, sql: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

async function emit(ctx: JourneyContext, psl: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);
}

/** The base table, applied, with no rows. */
async function applied(createTempDir: () => string): Promise<SqliteJourney> {
  const ctx = setup(createTempDir);
  expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
  const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);
  const apply0 = await runMigrate(ctx);
  expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);
  return ctx;
}

/** The base table, applied, with two rows. */
async function seeded(createTempDir: () => string): Promise<SqliteJourney> {
  const ctx = await applied(createTempDir);
  exec(ctx.dbPath, `INSERT INTO "User" (id, age, nickname) VALUES (1, '10', 'al'), (2, '7', NULL)`);
  return ctx;
}

const WITH_ROLE = `${BASE.replace('  nickname String?\n', '  nickname String?\n  role     Role\n')}
enum Role {
  @@type("sqlite/text@1")
  Admin = "admin"
  Member = "member"
}
`;

const WITH_CODE = BASE.replace(
  '  nickname String?\n',
  '  nickname String?\n  code     String @unique\n',
);

/** Plans the emitted contract from the latest migration, with no statement, and self-emits it. */
async function plannedPlain(ctx: SqliteJourney, name: string): Promise<string> {
  const planned = await planMigrationAndSelfEmit(ctx, [
    '--name',
    name,
    '--from',
    latestMigrationDirName(ctx),
  ]);
  expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
  return plannedDir(ctx, name.replaceAll('-', '_'));
}

function plannedDir(ctx: JourneyContext, token: string): string {
  const migrationsDir = join(ctx.testDir, 'migrations', 'app');
  const [dirName] = readdirSync(migrationsDir).filter((dir) => dir.includes(token));
  expect(dirName, `planned migration ${token}`).toBeDefined();
  return join(migrationsDir, dirName ?? '');
}

async function fillAndApply(
  ctx: JourneyContext,
  migrationDir: string,
  fill: (scaffold: string) => string,
): Promise<void> {
  const migrationTs = join(migrationDir, 'migration.ts');
  const filled = fill(readFileSync(migrationTs, 'utf-8'));
  expect(filled).not.toContain('placeholder(');
  writeFileSync(migrationTs, filled);
  const selfEmit = () =>
    selfEmitMigration(ctx, ['--dir', migrationDir, '--config', ctx.configPath]);
  const emitted = await selfEmit();
  expect(emitted.exitCode, `self-emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
  const ops = readFileSync(join(migrationDir, 'ops.json'), 'utf-8');
  expect((await selfEmit()).exitCode, 'second self-emit').toBe(0);
  expect(
    readFileSync(join(migrationDir, 'ops.json'), 'utf-8'),
    'a re-run reproduces ops.json',
  ).toBe(ops);
  const applied = await runMigrate(ctx);
  expect(applied.exitCode, `apply: ${applied.stdout}\n${applied.stderr}`).toBe(0);
  await expectSettled(ctx);
}

/** A further plan has nothing to do, and the database matches the contract. */
async function expectSettled(ctx: JourneyContext): Promise<void> {
  const again = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx), '--json']);
  expect(again.exitCode, `plan again: ${again.stderr}`).toBe(0);
  expect(parseJsonOutput<{ noOp: boolean }>(again).noOp).toBe(true);
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `db verify: ${verify.stdout}\n${verify.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('SQLite: --convert, --backfill and the temporary value on a table with rows', () => {
    it(
      'refuses db update --backfill without creating a database that does not exist',
      async () => {
        const ctx = setup(createTempDir);
        const missingDirectory = join(ctx.testDir, 'missing', 'journey.db');
        const elsewhere = { ...ctx, dbPath: missingDirectory };
        writeFileSync(
          ctx.configPath,
          readFileSync(ctx.configPath, 'utf-8').replace(ctx.dbPath, () => missingDirectory),
        );
        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const missingFile = setup(createTempDir);
        await emit(missingFile, BASE.replace('age      String', 'age      Int'));

        for (const journey of [elsewhere, missingFile]) {
          const refused = await runDbUpdate(journey, ['--backfill', 'User.age', '--json']);
          expect(parseJsonOutput(refused)).toMatchObject({
            code: 'MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE',
          });
          expect(existsSync(journey.dbPath), journey.dbPath).toBe(false);
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'converts a type change through the slot of the rebuild',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const from = ['--name', 'age-to-int', '--from', latestMigrationDirName(ctx)];

        const asked = await runMigrationPlan(ctx, [...from, '--json']);
        expect(asked.exitCode, 'a lossy type change is a question').toBe(2);
        expect(JSON.stringify(parseJsonOutput(asked))).toContain('--convert User.age');

        const planned = await runMigrationPlan(ctx, [...from, '--convert', 'User.age', '--json']);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        expect(parseJsonOutput(planned)).toMatchObject({ pendingPlaceholders: true });

        const slot = /placeholder\((['"])User\.age:convert\1\)/;
        await fillAndApply(ctx, plannedDir(ctx, 'age_to_int'), (scaffold) => {
          expect(scaffold).toMatch(slot);
          return scaffold.replace(slot, `'CAST("age" AS INTEGER)'`);
        });

        expect(
          query(ctx.dbPath, `SELECT id, age, typeof(age) AS stored FROM "User" ORDER BY id`),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer' },
          { id: 2, age: 7, stored: 'integer' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'checks the converted values after the copy: a deleted or wrong conversion fails naming the field',
      async () => {
        const ctx = await seeded(createTempDir);
        exec(ctx.dbPath, `UPDATE "User" SET age = 'ten' WHERE id = 1`);
        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'age-to-int',
          '--from',
          latestMigrationDirName(ctx),
          '--convert',
          'User.age',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const migrationDir = plannedDir(ctx, 'age_to_int');
        const migrationTs = join(migrationDir, 'migration.ts');
        const scaffold = readFileSync(migrationTs, 'utf-8');
        const slot = /placeholder\((['"])User\.age:convert\1\)/;
        expect(scaffold).toMatch(/retypedColumns: \[\s*['"]age['"]\s*\]/);

        const failsNamingTheField = async (
          filled: string,
          expected: { readonly why: string; readonly text: string },
        ) => {
          expect(filled).not.toContain('placeholder(');
          writeFileSync(migrationTs, filled);
          const emitted = await selfEmitMigration(ctx, [
            '--dir',
            migrationDir,
            '--config',
            ctx.configPath,
          ]);
          expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);
          const failed = await runMigrate(ctx, ['--json']);
          expect(failed.exitCode, 'the conversion fails').not.toBe(0);
          const error = parseJsonOutput<{
            readonly why: string;
            readonly nextActions: readonly { readonly label: string; readonly reason?: string }[];
          }>(failed);
          expect(error.why).toContain(expected.why);
          const advice = error.nextActions
            .map(({ label, reason }) => `${reason ?? ''}\n${label}`)
            .join('\n');
          expect(advice).toContain(expected.text);
          expect(advice).toContain(
            `Fix the conversion in \`${relative(ctx.testDir, migrationTs)}\`, run \`node ${relative(ctx.testDir, migrationTs)}`,
          );
          expect(advice).toContain('db migrate');
          expect(advice).not.toContain('--convert');
          expect(query(ctx.dbPath, `SELECT id, age FROM "User" ORDER BY id`)).toEqual([
            { id: 1, age: 'ten' },
            { id: 2, age: '7' },
          ]);
        };
        const leftAValue = {
          why: `The value 'ten' of column "age" on "User" is still stored as text, which INTEGER cannot hold.`,
          text: 'The conversion of field "User.age" left a value its new type cannot hold.',
        };

        writeFileSync(
          migrationTs,
          scaffold
            .split('\n')
            .filter((line) => !slot.test(line))
            .join('\n'),
        );
        expect(
          (await selfEmitMigration(ctx, ['--dir', migrationDir, '--config', ctx.configPath]))
            .exitCode,
          'self-emit without the copy expression',
        ).toBe(0);
        const unconverted = await runMigrate(ctx, ['--json']);
        expect(unconverted.exitCode, 'the copy leaves the old values').not.toBe(0);
        const unconvertedAdvice = parseJsonOutput<{
          readonly nextActions: readonly { readonly label: string }[];
        }>(unconverted)
          .nextActions.map(({ label }) => label)
          .join('\n');
        expect(unconvertedAdvice).toContain(
          `\`${relative(ctx.testDir, migrationTs)}\` has no conversion for field "User.age": write one there, run \`node ${relative(ctx.testDir, migrationTs)}`,
        );
        expect(query(ctx.dbPath, `SELECT id, age FROM "User" ORDER BY id`)).toEqual([
          { id: 1, age: 'ten' },
          { id: 2, age: '7' },
        ]);

        await failsNamingTheField(scaffold.replace(slot, `'trim("age")'`), leftAValue);
        await failsNamingTheField(scaffold.replace(slot, `'to_int("age")'`), {
          why: 'no such function: to_int',
          text: 'The conversion of field "User.age" failed with an error in its expression.',
        });
        await failsNamingTheField(scaffold.replace(slot, `"NULLIF(\\"age\\", 'ten')"`), {
          why: 'NOT NULL constraint failed',
          text: 'The conversion of field "User.age" left a value its new type cannot hold.',
        });

        await fillAndApply(ctx, migrationDir, () =>
          scaffold.replace(
            slot,
            `"CASE WHEN \\"age\\" = 'ten' THEN 10 ELSE CAST(\\"age\\" AS INTEGER) END"`,
          ),
        );
        expect(
          query(ctx.dbPath, `SELECT id, age, typeof(age) AS stored FROM "User" ORDER BY id`),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer' },
          { id: 2, age: 7, stored: 'integer' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'follows the advice of a --delete type change that cannot cast a value to a converted migration',
      async () => {
        const ctx = await seeded(createTempDir);
        exec(ctx.dbPath, `UPDATE "User" SET age = 'ten' WHERE id = 1`);
        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const deleted = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'age-to-int',
          '--from',
          latestMigrationDirName(ctx),
          '--delete',
          'User.age',
        ]);
        expect(deleted.exitCode, `plan: ${deleted.stderr}`).toBe(0);

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode, 'the cast meets a value it cannot convert').not.toBe(0);
        const error = parseJsonOutput<{
          readonly why: string;
          readonly nextActions: readonly { readonly label: string }[];
        }>(failed);
        expect(error.why).toBe(
          `The value 'ten' of column "age" on "User" is still stored as text, which INTEGER cannot hold. The failed apply changed nothing.`,
        );
        const advice = error.nextActions.map(({ label }) => label).join('\n');
        const followed = /delete `([^`]+)`.*?plan it again with `\S+ migration plan ([^`]+)`/i.exec(
          advice,
        );
        expect(followed, advice).not.toBeNull();
        const [, directory = '', command = ''] = followed ?? [];
        expect(query(ctx.dbPath, `SELECT id, age FROM "User" ORDER BY id`)).toEqual([
          { id: 1, age: 'ten' },
          { id: 2, age: '7' },
        ]);

        rmSync(resolve(ctx.testDir, directory), { recursive: true });
        const planned = await runMigrationPlan(ctx, command.split(' '));
        expect(planned.exitCode, `plan as printed: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        await fillAndApply(
          ctx,
          join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx)),
          (scaffold) =>
            scaffold.replace(
              /placeholder\((['"])User\.age:convert\1\)/,
              `"CASE WHEN \\"age\\" = 'ten' THEN 10 ELSE CAST(\\"age\\" AS INTEGER) END"`,
            ),
        );

        expect(
          query(ctx.dbPath, `SELECT id, age, typeof(age) AS stored FROM "User" ORDER BY id`),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer' },
          { id: 2, age: 7, stored: 'integer' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'names the right field and advice for a --convert and a --delete in one rebuild',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(
          ctx,
          BASE.replace('age      String', 'age      Int').replace(
            'nickname String?',
            'nickname Int?',
          ),
        );
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'age-and-nickname',
          '--from',
          latestMigrationDirName(ctx),
          '--convert',
          'User.age',
          '--delete',
          'User.nickname',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const migrationDir = plannedDir(ctx, 'age_and_nickname');
        const migrationTs = join(migrationDir, 'migration.ts');
        const scaffold = readFileSync(migrationTs, 'utf-8');
        expect(scaffold).toMatch(/retypedColumns: \[\s*['"]age['"],\s*['"]nickname['"]\s*\]/);
        const slot = /placeholder\((['"])User\.age:convert\1\)/;

        const adviceOf = async (conversion: string) => {
          writeFileSync(migrationTs, scaffold.replace(slot, conversion));
          const emitted = await selfEmitMigration(ctx, [
            '--dir',
            migrationDir,
            '--config',
            ctx.configPath,
          ]);
          expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);
          const failed = await runMigrate(ctx, ['--json']);
          expect(failed.exitCode, 'the rebuild fails').not.toBe(0);
          return parseJsonOutput<{
            readonly nextActions: readonly { readonly label: string; readonly reason?: string }[];
          }>(failed)
            .nextActions.map(({ label, reason }) => `${reason ?? ''}\n${label}`)
            .join('\n');
        };

        const castFailed = await adviceOf(`'CAST("age" AS INTEGER)'`);
        expect(castFailed).toContain(
          `A value of field "User.nickname" cannot be converted to its new type by the database's cast.`,
        );
        expect(castFailed).not.toContain('The conversion of field');
        expect(castFailed).toContain(
          'has no conversion for field "User.nickname": write one there',
        );

        exec(
          ctx.dbPath,
          `UPDATE "User" SET nickname = '5' WHERE id = 1; UPDATE "User" SET age = 'ten' WHERE id = 2`,
        );
        const conversionFailed = await adviceOf(`'trim("age")'`);
        expect(conversionFailed).toContain(
          'The conversion of field "User.age" left a value its new type cannot hold.',
        );

        await fillAndApply(ctx, migrationDir, () =>
          scaffold.replace(
            slot,
            `"CASE WHEN \\"age\\" = 'ten' THEN 10 ELSE CAST(\\"age\\" AS INTEGER) END"`,
          ),
        );
        expect(
          query(
            ctx.dbPath,
            `SELECT id, age, typeof(age) AS stored, nickname FROM "User" ORDER BY id`,
          ),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer', nickname: 5 },
          { id: 2, age: 10, stored: 'integer', nickname: null },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'blames no conversion for a copy that fails on another column of the same rebuild',
      async () => {
        const ctx = await seeded(createTempDir);
        exec(ctx.dbPath, `UPDATE "User" SET nickname = 'al'`);
        await emit(
          ctx,
          BASE.replace('age      String', 'age      Int').replace(
            'nickname String?',
            'nickname String? @unique',
          ),
        );
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'age-and-nickname',
          '--from',
          latestMigrationDirName(ctx),
          '--convert',
          'User.age',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const migrationDir = plannedDir(ctx, 'age_and_nickname');
        const migrationTs = join(migrationDir, 'migration.ts');
        writeFileSync(
          migrationTs,
          readFileSync(migrationTs, 'utf-8').replace(
            /placeholder\((['"])User\.age:convert\1\)/,
            `'CAST("age" AS INTEGER)'`,
          ),
        );
        const emitted = await selfEmitMigration(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode, 'the copy fails on the duplicate nickname').not.toBe(0);
        const error = parseJsonOutput<{
          readonly why: string;
          readonly nextActions: readonly { readonly label: string }[];
        }>(failed);
        expect(error.why).toContain('UNIQUE constraint failed');
        const advice = error.nextActions.map(({ label }) => label).join('\n');
        expect(advice).not.toContain('conversion');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'plans a type change answered with --delete as a rebuild that checks the copied values',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'age-delete',
          '--from',
          latestMigrationDirName(ctx),
          '--delete',
          'User.age',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const scaffold = readFileSync(join(plannedDir(ctx, 'age_delete'), 'migration.ts'), 'utf-8');
        expect(scaffold).not.toContain('copyExpressions');
        expect(scaffold).toMatch(/retypedColumns: \[\s*['"]age['"]\s*\]/);
        await fillAndApply(ctx, plannedDir(ctx, 'age_delete'), (unchanged) => unchanged);
        expect(
          query(ctx.dbPath, `SELECT id, age, typeof(age) AS stored FROM "User" ORDER BY id`),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer' },
          { id: 2, age: 7, stored: 'integer' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fails naming the rows that hold NULL in a field made required, and applies once they hold values',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, BASE.replace('nickname String?', 'nickname String '));
        await plannedPlain(ctx, 'nickname-required');

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        expect(parseJsonOutput<{ readonly summary: string }>(failed).summary).toBe(
          '1 row of "User" holds NULL in "nickname", so it cannot become required.',
        );

        exec(ctx.dbPath, `UPDATE "User" SET nickname = 'anon' WHERE nickname IS NULL`);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `apply: ${applied.stdout}\n${applied.stderr}`).toBe(0);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses db update --convert, and its printed migration plan command converts a database db init created',
      async () => {
        const ctx = setup(createTempDir);
        expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
        const initialized = await runDbInit(ctx);
        expect(initialized.exitCode, `db init: ${initialized.stderr}`).toBe(0);
        exec(ctx.dbPath, `INSERT INTO "User" (id, age, nickname) VALUES (1, '4', NULL)`);

        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const refused = await runDbUpdate(ctx, ['--convert', 'User.age', '--json']);
        const error = parseJsonOutput<{
          readonly code: string;
          readonly nextActions: readonly { readonly command?: string }[];
        }>(refused);
        expect(error.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        const command = error.nextActions.find(({ command }) =>
          command?.includes('migration plan'),
        )?.command;
        expect(command).toBeDefined();
        const planned = await runMigrationPlan(
          ctx,
          (command ?? '').replace(/^\S+ migration plan /, '').split(' '),
        );
        expect(planned.exitCode, `plan as printed: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        await fillAndApply(
          ctx,
          join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx)),
          (scaffold) =>
            scaffold.replace(
              /placeholder\((['"])User\.age:convert\1\)/,
              `'CAST("age" AS INTEGER)'`,
            ),
        );
        expect(query(ctx.dbPath, `SELECT id, age FROM "User"`)).toEqual([{ id: 1, age: 4 }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'gives a new required field a temporary value in the old rows, then makes it NOT NULL',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(
          ctx,
          BASE.replace('  nickname String?\n', '  nickname String?\n  name     String\n'),
        );
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'add-name',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        expect(parseJsonOutput(planned)).not.toHaveProperty('pendingPlaceholders');
        expect(parseJsonOutput(planned)).toMatchObject({
          temporaryValues: [{ field: 'User.name', value: "''" }],
        });

        const migrationDir = plannedDir(ctx, 'add_name');
        const opsPlanned = readFileSync(join(migrationDir, 'ops.json'), 'utf-8');
        expect(readFileSync(join(migrationDir, 'migration.ts'), 'utf-8')).toMatch(
          /temporaryValues:\s*\{\s*['"]?name['"]?:\s*sql`''`/,
        );
        expect(opsPlanned, 'a temporary value is no type change').not.toMatch(
          /convertedColumn|conversionCopy/,
        );
        await fillAndApply(ctx, migrationDir, (scaffold) => scaffold);
        expect(readFileSync(join(migrationDir, 'ops.json'), 'utf-8')).toBe(opsPlanned);

        expect(query(ctx.dbPath, `SELECT id, name FROM "User" ORDER BY id`)).toEqual([
          { id: 1, name: '' },
          { id: 2, name: '' },
        ]);
        expect(
          query(
            ctx.dbPath,
            `SELECT "notnull", dflt_value FROM pragma_table_info('User') WHERE name = 'name'`,
          ),
        ).toEqual([{ notnull: 1, dflt_value: null }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'follows the advice of a backfill step that leaves a row without a value to fixing that step',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(
          ctx,
          BASE.replace('  nickname String?\n', '  nickname String?\n  name     String\n'),
        );
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'partial-backfill',
          '--from',
          latestMigrationDirName(ctx),
          '--backfill',
          'User.name',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const migrationDir = plannedDir(ctx, 'partial_backfill');
        const migrationTs = join(migrationDir, 'migration.ts');
        const slot = /\(\) => placeholder\((['"])User\.name:run\1\)/;
        writeFileSync(
          migrationTs,
          readFileSync(migrationTs, 'utf-8').replace(
            slot,
            '() => `UPDATE "User" SET name = \'first\' WHERE id = 1`',
          ),
        );
        const emitted = await selfEmitMigration(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const error = parseJsonOutput<{
          readonly summary: string;
          readonly nextActions: readonly { readonly label: string }[];
        }>(failed);
        expect(error.summary).toBe(
          '1 row of "User" still holds NULL in "name" after its backfill step, so it cannot become required.',
        );
        const advice = error.nextActions.map(({ label }) => label).join('\n');
        expect(advice).not.toContain('--backfill');
        const file = /Make its run fill every row in `([^`]+)`/.exec(advice)?.[1];
        expect(file, advice).toBe(relative(ctx.testDir, migrationTs));

        await fillAndApply(ctx, migrationDir, (scaffold) =>
          scaffold.replace(
            '`UPDATE "User" SET name = \'first\' WHERE id = 1`',
            '`UPDATE "User" SET name = \'user \' || id WHERE name IS NULL`',
          ),
        );
        expect(query(ctx.dbPath, `SELECT id, name FROM "User" ORDER BY id`)).toEqual([
          { id: 1, name: 'user 1' },
          { id: 2, name: 'user 2' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'adds a new required field nullable, fills it through the backfill slot, then tightens it',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(
          ctx,
          BASE.replace('  nickname String?\n', '  nickname String?\n  name     String\n'),
        );
        const from = ['--name', 'backfill-name', '--from', latestMigrationDirName(ctx)];
        const advised = await runMigrationPlan(ctx, from);
        expect(advised.exitCode, `plan: ${advised.stderr}`).toBe(0);
        const advice = /plan again with (--backfill \S+)\./.exec(
          `${advised.stdout}${advised.stderr}`,
        )?.[1];
        expect(advice).toBe('--backfill User.name');
        rmSync(plannedDir(ctx, 'backfill_name'), { recursive: true });
        const planned = await runMigrationPlan(ctx, [...from, ...(advice ?? '').split(' ')]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);

        const slot = /\(\) => placeholder\((['"])User\.name:run\1\)/;
        await fillAndApply(ctx, plannedDir(ctx, 'backfill_name'), (scaffold) => {
          expect(scaffold).toMatch(slot);
          return scaffold.replace(
            slot,
            '() => `UPDATE "User" SET name = \'user \' || id WHERE name IS NULL`',
          );
        });

        expect(query(ctx.dbPath, `SELECT id, name FROM "User" ORDER BY id`)).toEqual([
          { id: 1, name: 'user 1' },
          { id: 2, name: 'user 2' },
        ]);
        expect(
          query(ctx.dbPath, `SELECT "notnull" FROM pragma_table_info('User') WHERE name = 'name'`),
        ).toEqual([{ notnull: 1 }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fills an optional field made required through the backfill slot, then tightens it',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, BASE.replace('nickname String?', 'nickname String '));
        const planned = await runMigrationPlan(ctx, [
          '--name',
          'nickname-required',
          '--from',
          latestMigrationDirName(ctx),
          '--backfill',
          'User.nickname',
          '--json',
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);

        const slot = /\(\) => placeholder\((['"])User\.nickname:run\1\)/;
        await fillAndApply(ctx, plannedDir(ctx, 'nickname_required'), (scaffold) => {
          expect(scaffold).toMatch(slot);
          return scaffold.replace(
            slot,
            '() => `UPDATE "User" SET nickname = \'anon\' WHERE nickname IS NULL`',
          );
        });

        expect(query(ctx.dbPath, `SELECT id, nickname FROM "User" ORDER BY id`)).toEqual([
          { id: 1, nickname: 'al' },
          { id: 2, nickname: 'anon' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'gives a new required enum field no temporary value, so a table with rows refuses it',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, WITH_ROLE);
        const migrationDir = await plannedPlain(ctx, 'add-role');
        expect(readFileSync(join(migrationDir, 'migration.ts'), 'utf-8')).not.toContain(
          'temporaryValues',
        );

        const refused = await runMigrate(ctx);
        expect(refused.exitCode, 'the rebuild cannot copy the rows').not.toBe(0);
        expect(`${refused.stdout}${refused.stderr}`).toContain('NOT NULL');
        expect(
          query(ctx.dbPath, `SELECT name FROM pragma_table_info('User') ORDER BY name`),
        ).toEqual([{ name: 'age' }, { name: 'id' }, { name: 'nickname' }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'carries a new required unique field through the rebuild, which applies to an empty table',
      async () => {
        const ctx = await applied(createTempDir);
        await emit(ctx, WITH_CODE);
        await plannedPlain(ctx, 'add-code');
        const added = await runMigrate(ctx);
        expect(added.exitCode, `apply: ${added.stdout}\n${added.stderr}`).toBe(0);
        expect(
          query(ctx.dbPath, `SELECT "notnull" FROM pragma_table_info('User') WHERE name = 'code'`),
        ).toEqual([{ notnull: 1 }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'carries a new required unique field through the rebuild, which a table with rows refuses',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, WITH_CODE);
        await plannedPlain(ctx, 'add-code');
        const refused = await runMigrate(ctx);
        expect(refused.exitCode, 'the rebuild cannot copy the rows').not.toBe(0);
        expect(`${refused.stdout}${refused.stderr}`).toContain('NOT NULL');
        expect(query(ctx.dbPath, `SELECT count(*) AS rows FROM "User"`)).toEqual([{ rows: 2 }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'follows the advice for NULL rows beside a new required field to a migration that fills both',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(ctx, WITH_ROLE.replace('nickname String?', 'nickname String '));
        await plannedPlain(ctx, 'nickname-and-role');

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const advice = parseJsonOutput<{
          readonly nextActions: readonly { readonly label: string }[];
        }>(failed)
          .nextActions.map(({ label }) => label)
          .join('\n');
        expect(advice).not.toContain('re-run');
        const directory = /delete `([^`]+)`/i.exec(advice)?.[1];
        const command = /`\S+ migration plan ([^`]+)`/.exec(advice)?.[1];
        const args = (command ?? '').split(' ');
        expect(args).toEqual(expect.arrayContaining(['User.nickname', 'User.role']));

        rmSync(resolve(ctx.testDir, directory ?? ''), { recursive: true });
        const planned = await runMigrationPlan(ctx, args);
        expect(planned.exitCode, `plan as printed: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        await fillAndApply(
          ctx,
          join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx)),
          (scaffold) =>
            scaffold
              .replace(
                /\(\) => placeholder\((['"])User\.nickname:run\1\)/,
                '() => `UPDATE "User" SET nickname = \'anon\' WHERE nickname IS NULL`',
              )
              .replace(
                /\(\) => placeholder\((['"])User\.role:run\1\)/,
                '() => `UPDATE "User" SET role = \'member\' WHERE role IS NULL`',
              ),
        );
        expect(query(ctx.dbPath, `SELECT id, nickname, role FROM "User" ORDER BY id`)).toEqual([
          { id: 1, nickname: 'al', role: 'member' },
          { id: 2, nickname: 'anon', role: 'member' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'follows the advice for two new required fields without a value to a migration that fills both',
      async () => {
        const ctx = await seeded(createTempDir);
        await emit(
          ctx,
          WITH_ROLE.replace('  role     Role\n', '  role     Role\n  code     String @unique\n'),
        );
        await plannedPlain(ctx, 'role-and-code');

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const error = parseJsonOutput<{
          readonly nextActions: readonly { readonly label: string }[];
        }>(failed);
        const advice = error.nextActions.map(({ label }) => label).join('\n');
        const directory = /delete `([^`]+)`/i.exec(advice)?.[1];
        const command = /`\S+ migration plan ([^`]+)`/.exec(advice)?.[1];
        expect([directory, command], advice).toEqual([expect.any(String), expect.any(String)]);
        const args = (command ?? '').split(' ');
        expect(args).toEqual(expect.arrayContaining(['--backfill', 'User.role', 'User.code']));

        rmSync(resolve(ctx.testDir, directory ?? ''), { recursive: true });
        const planned = await runMigrationPlan(ctx, args);
        expect(planned.exitCode, `plan as printed: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        await fillAndApply(
          ctx,
          join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx)),
          (scaffold) =>
            scaffold
              .replace(
                /\(\) => placeholder\((['"])User\.role:run\1\)/,
                '() => `UPDATE "User" SET role = \'member\' WHERE role IS NULL`',
              )
              .replace(
                /\(\) => placeholder\((['"])User\.code:run\1\)/,
                '() => `UPDATE "User" SET code = \'c\' || id WHERE code IS NULL`',
              ),
        );

        expect(query(ctx.dbPath, `SELECT id, role, code FROM "User" ORDER BY id`)).toEqual([
          { id: 1, role: 'member', code: 'c1' },
          { id: 2, role: 'member', code: 'c2' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db update asks about a lossy type change offering only --delete, casts with it, and gives a new required field a temporary value',
      async () => {
        const ctx = setup(createTempDir);
        expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
        expect((await runDbUpdate(ctx)).exitCode, 'db update base').toBe(0);
        exec(
          ctx.dbPath,
          `INSERT INTO "User" (id, age, nickname) VALUES (1, '10', NULL), (2, 'abc', 'bo')`,
        );

        await emit(ctx, BASE.replace('age      String', 'age      Int'));
        const asked = await runDbUpdate(ctx, ['--json']);
        const question = parseJsonOutput<{ readonly code: string; readonly nextActions: unknown }>(
          asked,
        );
        expect(question.code).toBe('CLI.CONSENT_REQUIRED');
        expect(JSON.stringify(question.nextActions)).toContain('--delete User.age');
        expect(JSON.stringify(question.nextActions)).not.toContain('--convert');

        const failed = await runDbUpdate(ctx, ['--delete', 'User.age', '--json']);
        const error = parseJsonOutput<{ readonly code: string; readonly nextActions: unknown }>(
          failed,
        );
        expect(error.code).toBe('MIGRATION.POSTCHECK_FAILED');
        expect(JSON.stringify(error.nextActions)).toContain('--convert User.age');
        exec(ctx.dbPath, `UPDATE "User" SET age = '7' WHERE id = 2`);
        const cast = await runDbUpdate(ctx, ['--delete', 'User.age']);
        expect(cast.exitCode, `db update --delete: ${cast.stdout}\n${cast.stderr}`).toBe(0);
        expect(
          query(ctx.dbPath, `SELECT id, age, typeof(age) AS stored FROM "User" ORDER BY id`),
        ).toEqual([
          { id: 1, age: 10, stored: 'integer' },
          { id: 2, age: 7, stored: 'integer' },
        ]);

        await emit(
          ctx,
          BASE.replace('age      String', 'age      Int').replace(
            '  nickname String?\n',
            '  nickname String?\n  name     String\n',
          ),
        );
        const added = await runDbUpdate(ctx);
        expect(added.exitCode, `db update name: ${added.stdout}\n${added.stderr}`).toBe(0);
        expect(`${added.stdout}${added.stderr}`).toContain(
          `Existing rows got '' in field "User.name". To choose the value, plan a migration with prisma-test migration plan --backfill User.name instead.`,
        );
        expect(query(ctx.dbPath, `SELECT id, name FROM "User" ORDER BY id`)).toEqual([
          { id: 1, name: '' },
          { id: 2, name: '' },
        ]);
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `db verify: ${verify.stdout}\n${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('SQLite: a new required indexed field and a new required relation', () => {
    const TEAMS = `// use prisma-8

model Team {
  id    Int    @id
}

model User {
  id    Int    @id
  name  String
}
`;
    const withRank = TEAMS.replace(
      '  name  String\n',
      '  name  String\n  rank  Int\n\n  @@index([rank])\n',
    );
    const withTeam = withRank
      .replace('  id    Int    @id\n}', '  id    Int    @id\n  users User[]\n}')
      .replace(
        '  rank  Int\n',
        '  rank  Int\n  teamId Int\n  team  Team @relation(fields: [teamId], references: [id])\n',
      );

    async function base(createTempDir: () => string, apply: 'db update' | 'db migrate') {
      const ctx = setup(createTempDir);
      await emit(ctx, TEAMS);
      if (apply === 'db update') {
        expect((await runDbUpdate(ctx)).exitCode, 'db update base').toBe(0);
      } else {
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'apply initial').toBe(0);
      }
      return ctx;
    }

    async function planAndMigrate(ctx: SqliteJourney, name: string, extra: readonly string[] = []) {
      const planned = await planMigrationAndSelfEmit(ctx, [
        '--name',
        name,
        '--from',
        latestMigrationDirName(ctx),
        ...extra,
      ]);
      expect(planned.exitCode, `plan ${name}: ${planned.stderr}`).toBe(0);
      return runMigrate(ctx, ['--json']);
    }

    it(
      'adds both to an empty table through db update and through migration plan and db migrate',
      async () => {
        const updated = await base(createTempDir, 'db update');
        await emit(updated, withTeam);
        const update = await runDbUpdate(updated);
        expect(update.exitCode, `db update: ${update.stdout}\n${update.stderr}`).toBe(0);
        const verify = await runDbVerify(updated, ['--schema-only']);
        expect(verify.exitCode, `db verify: ${verify.stdout}\n${verify.stderr}`).toBe(0);

        const migrated = await base(createTempDir, 'db migrate');
        await emit(migrated, withTeam);
        const applied = await planAndMigrate(migrated, 'rank-and-team');
        expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
        await expectSettled(migrated);
        expect(
          query(migrated.dbPath, `SELECT name FROM pragma_index_list('User') ORDER BY name`).map(
            ({ name }) => name,
          ),
        ).toEqual(expect.arrayContaining([expect.stringMatching(/rank/)]));
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'gives the indexed field a temporary value on a table with rows, and fills the relation through --backfill',
      async () => {
        const updated = await base(createTempDir, 'db update');
        exec(
          updated.dbPath,
          `INSERT INTO "Team" (id) VALUES (1); INSERT INTO "User" (id, name) VALUES (1, 'a')`,
        );
        await emit(updated, withRank);
        const update = await runDbUpdate(updated);
        expect(update.exitCode, `db update: ${update.stdout}\n${update.stderr}`).toBe(0);
        expect(query(updated.dbPath, `SELECT rank FROM "User"`)).toEqual([{ rank: 0 }]);
        await emit(updated, withTeam);
        const refused = await runDbUpdate(updated, ['--json']);
        expect(parseJsonOutput<{ readonly summary: string }>(refused).summary).toBe(
          '"User" has 1 row, so the new required column "teamId" cannot be added: it can be added to an empty table only.',
        );

        const migrated = await base(createTempDir, 'db migrate');
        exec(
          migrated.dbPath,
          `INSERT INTO "Team" (id) VALUES (1); INSERT INTO "User" (id, name) VALUES (1, 'a')`,
        );
        await emit(migrated, withRank);
        const ranked = await planAndMigrate(migrated, 'rank');
        expect(ranked.exitCode, `db migrate rank: ${ranked.stdout}\n${ranked.stderr}`).toBe(0);
        await emit(migrated, withTeam);
        const planned = await runMigrationPlan(migrated, [
          '--name',
          'team',
          '--from',
          latestMigrationDirName(migrated),
          '--backfill',
          'User.teamId',
        ]);
        expect(planned.exitCode, `plan team: ${planned.stderr}`).toBe(0);
        await fillAndApply(migrated, plannedDir(migrated, 'team'), (scaffold) =>
          scaffold.replace(
            /\(\) => placeholder\((['"])User\.teamId:run\1\)/,
            '() => `UPDATE "User" SET "teamId" = 1 WHERE "teamId" IS NULL`',
          ),
        );
        expect(query(migrated.dbPath, `SELECT id, rank, "teamId" FROM "User"`)).toEqual([
          { id: 1, rank: 0, teamId: 1 },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
