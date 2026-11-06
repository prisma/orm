/**
 * `--convert`, `--backfill` and the temporary value on Postgres, end to end on a table with rows.
 *
 * A lossy type change is refused without a statement; `--delete` plans the direct alter, and
 * `--convert` writes a `User.age:convert` slot in `using` that, filled and re-run, converts the rows. A new required field
 * gets a temporary value without a statement, and a backfill step with `--backfill`, whose `run`
 * first misses a row and fails counting it. An optional
 * field made required while rows hold NULL fails naming the rows, and applies once they hold
 * values. `db update --convert` is refused, and the `migration plan` command it prints, run as
 * printed on a database `db init` created, leads to an applied conversion. After each journey a
 * further plan has nothing to do, `db verify --schema-only` is clean, and re-running every
 * `migration.ts` the journey filled reproduces its `ops.json`.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  injectMigrationSqlDbSetup,
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
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

function contractWith(fields: string): string {
  return `// use prisma-8

model User {
  id    Int    @id
  email String
${fields}
  @@map("user")
}
`;
}

async function emit(ctx: JourneyContext, psl: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);
}

async function migrated(ctx: JourneyContext, psl: string): Promise<void> {
  await emit(ctx, psl);
  const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
  const applied = await runMigrate(ctx);
  expect(applied.exitCode, `apply initial: ${applied.stderr}`).toBe(0);
}

function latestDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx));
}

/** Fills the latest migration.ts, re-runs it, applies it, and checks a second re-run changes nothing. */
async function fillAndApply(ctx: JourneyContext, fill: (scaffold: string) => string) {
  const dir = latestDir(ctx);
  const migrationTs = join(dir, 'migration.ts');
  const filled = fill(readFileSync(migrationTs, 'utf-8'));
  expect(filled).not.toContain('placeholder(');
  writeFileSync(migrationTs, filled);
  const selfEmit = () => selfEmitMigration(ctx, ['--dir', dir, '--config', ctx.configPath]);
  const emitted = await selfEmit();
  expect(emitted.exitCode, `self-emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
  const ops = readFileSync(join(dir, 'ops.json'), 'utf-8');
  expect((await selfEmit()).exitCode, 'second self-emit').toBe(0);
  expect(readFileSync(join(dir, 'ops.json'), 'utf-8'), 'a re-run reproduces ops.json').toBe(ops);
  const applied = await runMigrate(ctx);
  expect(applied.exitCode, `apply: ${applied.stdout}\n${applied.stderr}`).toBe(0);
}

/** A further plan has nothing to do, and the database matches the contract. */
async function expectSettled(ctx: JourneyContext): Promise<void> {
  const again = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx), '--json']);
  expect(again.exitCode, `plan again: ${again.stderr}`).toBe(0);
  expect(parseJsonOutput<{ noOp: boolean }>(again).noOp).toBe(true);
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `db verify: ${verify.stdout}\n${verify.stderr}`).toBe(0);
}

const fillUsing = (expression: string) => (scaffold: string) =>
  scaffold.replace(/placeholder\((['"])User\.age:convert\1\)/, `'${expression}'`);

withTempDir(({ createTempDir }) => {
  describe('Postgres: a lossy type change', () => {
    const db = useDevDatabase();

    it(
      'is refused without a statement, planned directly with --delete, and converted with --convert',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx, contractWith('  age   String\n'));
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, email, age) VALUES (1, 'a', '10'), (2, 'b', ' 7')`,
        );
        await emit(ctx, contractWith('  age   Int\n'));
        const from = ['--name', 'age-to-int', '--from', latestMigrationDirName(ctx)];

        const asked = await runMigrationPlan(ctx, [...from, '--json']);
        expect(asked.exitCode, 'a lossy type change is a question').toBe(2);
        expect(JSON.stringify(engineError(asked)?.nextActions)).toContain('--convert User.age');

        const both = await runMigrationPlan(ctx, [
          ...from,
          '--convert',
          'User.age',
          '--delete',
          'User.age',
          '--json',
        ]);
        expect(engineError(both)).toMatchObject({
          code: 'MIGRATION.STATEMENT_INVALID',
          summary: '"--convert User.age" and "--delete User.age" conflict',
        });

        const deleted = await runMigrationPlan(ctx, [...from, '--delete', 'User.age']);
        expect(deleted.exitCode, `plan --delete: ${deleted.stderr}`).toBe(0);
        const direct = readFileSync(join(latestDir(ctx), 'migration.ts'), 'utf-8');
        expect(direct).toContain('this.alterColumnType(');
        expect(direct).not.toContain('using:');
        rmSync(latestDir(ctx), { recursive: true });

        const converted = await runMigrationPlan(ctx, [...from, '--convert', 'User.age']);
        expect(converted.exitCode, `plan --convert: ${converted.stderr}`).toBe(0);
        const migrationTs = join(latestDir(ctx), 'migration.ts');
        const scaffold = readFileSync(migrationTs, 'utf-8');
        writeFileSync(migrationTs, fillUsing('("age" || chr(120))::int4')(scaffold));
        const emitted = await selfEmitMigration(ctx, [
          '--dir',
          latestDir(ctx),
          '--config',
          ctx.configPath,
        ]);
        expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);
        const wrong = await runMigrate(ctx, ['--json']);
        expect(wrong.exitCode, 'the conversion fails on a value').not.toBe(0);
        const wrongAdvice = JSON.stringify([
          engineError(wrong)?.why,
          engineError(wrong)?.nextActions,
        ]);
        expect(wrongAdvice).toContain(
          'The conversion of field \\"User.age\\" failed on a value its new type cannot hold.',
        );
        expect(wrongAdvice).toContain(
          `Fix the conversion in \`${relative(ctx.testDir, migrationTs)}\``,
        );
        expect(wrongAdvice).not.toContain('--convert');

        writeFileSync(migrationTs, fillUsing('"age" + 1')(scaffold));
        const mistyped = await selfEmitMigration(ctx, [
          '--dir',
          latestDir(ctx),
          '--config',
          ctx.configPath,
        ]);
        expect(mistyped.exitCode, `self-emit: ${mistyped.stderr}`).toBe(0);
        const expressionError = await runMigrate(ctx, ['--json']);
        expect(expressionError.exitCode, 'the conversion has a SQL error').not.toBe(0);
        expect(engineError(expressionError)?.why).toContain('operator does not exist');
        const expressionErrorAdvice = JSON.stringify(engineError(expressionError)?.nextActions);
        expect(expressionErrorAdvice).toContain(
          'The conversion of field \\"User.age\\" failed with an error in its expression.',
        );
        expect(expressionErrorAdvice).toContain(
          `Fix the conversion in \`${relative(ctx.testDir, migrationTs)}\`, run \`node ${relative(ctx.testDir, migrationTs)}`,
        );
        expect(expressionErrorAdvice).toContain('db migrate');

        writeFileSync(migrationTs, scaffold);
        await fillAndApply(ctx, fillUsing('trim("age")::int4'));

        const rows = await sql(db.connectionString, `SELECT id, age FROM "user" ORDER BY id`);
        expect(rows.rows).toEqual([
          { id: 1, age: 10 },
          { id: 2, age: 7 },
        ]);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: new required fields', () => {
    const db = useDevDatabase();

    it(
      'gives one a temporary value without a statement, and fills another through --backfill',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx, contractWith(''));
        await sql(db.connectionString, `INSERT INTO "user" (id, email) VALUES (1, 'a'), (2, 'b')`);

        await emit(ctx, contractWith('  name  String\n'));
        const temporary = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'name',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(temporary.exitCode, `plan name: ${temporary.stderr}`).toBe(0);
        expect(`${temporary.stdout}${temporary.stderr}`).toContain(
          `Existing rows get '' in field "User.name". To choose the value, plan again with --backfill User.name.`,
        );
        expect(readFileSync(join(latestDir(ctx), 'migration.ts'), 'utf-8')).toContain(
          'temporaryDefault',
        );
        expect((await runMigrate(ctx)).exitCode, 'apply name').toBe(0);

        await emit(ctx, contractWith('  name  String\n  title String\n'));
        const titleFrom = ['--name', 'title', '--from', latestMigrationDirName(ctx)];
        const advised = await runMigrationPlan(ctx, titleFrom);
        expect(advised.exitCode, `plan title: ${advised.stderr}`).toBe(0);
        const advice = /plan again with (--backfill \S+)\./.exec(
          `${advised.stdout}${advised.stderr}`,
        )?.[1];
        expect(advice).toBe('--backfill User.title');
        rmSync(latestDir(ctx), { recursive: true });
        const backfill = await runMigrationPlan(ctx, [...titleFrom, ...(advice ?? '').split(' ')]);
        expect(backfill.exitCode, `plan --backfill: ${backfill.stderr}`).toBe(0);
        const migrationTs = join(latestDir(ctx), 'migration.ts');
        const scaffold = readFileSync(migrationTs, 'utf-8');
        const fillRun = (run: string) =>
          injectMigrationSqlDbSetup(scaffold)
            .replace(
              "() => placeholder('User.title:check')",
              "() => db.public.user.select('id').where((f, fns) => fns.eq(f.title, null)).limit(1)",
            )
            .replace("() => placeholder('User.title:run')", run);

        writeFileSync(
          migrationTs,
          fillRun(
            "() => db.public.user.update({ title: 'untitled' }).where((f, fns) => fns.eq(f.id, 1))",
          ),
        );
        const emitted = await selfEmitMigration(ctx, [
          '--dir',
          latestDir(ctx),
          '--config',
          ctx.configPath,
        ]);
        expect(emitted.exitCode, `self-emit: ${emitted.stderr}`).toBe(0);
        const missed = await runMigrate(ctx, ['--json']);
        expect(missed.exitCode).not.toBe(0);
        expect(engineError(missed)?.summary).toBe(
          '1 row of "user" still holds NULL in "title" after its backfill step, so it cannot become required.',
        );
        const missedAdvice = JSON.stringify(engineError(missed)?.nextActions);
        expect(missedAdvice).not.toContain('--backfill');
        expect(missedAdvice).toContain(
          `Make its run fill every row in \`${relative(ctx.testDir, migrationTs)}\``,
        );

        await fillAndApply(ctx, () =>
          fillRun(
            "() => db.public.user.update({ title: 'untitled' }).where((f, fns) => fns.eq(f.title, null))",
          ),
        );

        const rows = await sql(
          db.connectionString,
          `SELECT id, name, title FROM "user" ORDER BY id`,
        );
        expect(rows.rows).toEqual([
          { id: 1, name: '', title: 'untitled' },
          { id: 2, name: '', title: 'untitled' },
        ]);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: an optional field made required while rows hold NULL', () => {
    const db = useDevDatabase();

    it(
      'fails naming the rows, and applies once they hold values',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx, contractWith('  nick  String?\n'));
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, email, nick) VALUES (1, 'a', NULL), (2, 'b', 'bo')`,
        );
        await emit(ctx, contractWith('  nick  String\n'));
        const planned = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'nick',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        expect(engineError(failed)?.summary).toBe(
          '1 row of "user" holds NULL in "nick", so it cannot become required.',
        );
        expect(JSON.stringify(engineError(failed)?.nextActions)).toContain(
          'Set a value in that row and re-run',
        );

        await sql(db.connectionString, `UPDATE "user" SET nick = 'anon' WHERE nick IS NULL`);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `apply: ${applied.stderr}`).toBe(0);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: an optional field made required while rows hold NULL, kept optional', () => {
    const db = useDevDatabase();

    it(
      'follows the advice to keep the field optional',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx, contractWith('  nick  String?\n'));
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, email, nick) VALUES (1, 'a', NULL)`,
        );
        await emit(ctx, contractWith('  nick  String\n  title String?\n'));
        const planned = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'nick',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);

        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const advice = (engineError(failed)?.nextActions ?? [])
          .map((action) => action.label)
          .join('\n');
        const followed =
          /keep the field optional: .*?delete `([^`]+)`.*?plan it again with `\S+ migration plan ([^`]+)`/i.exec(
            advice,
          );
        expect(followed, advice).not.toBeNull();
        const [, directory = '', command = ''] = followed ?? [];

        await emit(ctx, contractWith('  nick  String?\n  title String?\n'));
        rmSync(join(ctx.testDir, directory), { recursive: true });
        const replanned = await planMigrationAndSelfEmit(ctx, command.split(' '));
        expect(replanned.exitCode, `plan as printed: ${replanned.stderr}`).toBe(0);
        expect(latestMigrationDirName(ctx)).toMatch(/_nick$/);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `apply: ${applied.stderr}`).toBe(0);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: db update --convert on a database db init created', () => {
    const db = useDevDatabase();

    it(
      'is refused, and the migration plan command it prints leads to an applied conversion',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, contractWith('  age   String\n'));
        const initialized = await runDbInit(ctx);
        expect(initialized.exitCode, `db init: ${initialized.stderr}`).toBe(0);
        await sql(db.connectionString, `INSERT INTO "user" (id, email, age) VALUES (1, 'a', '3')`);

        await emit(ctx, contractWith('  age   Int\n'));
        const refused = await runDbUpdate(ctx, ['--convert', 'User.age', '--json']);
        expect(engineError(refused)?.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        const command = engineError(refused)
          ?.nextActions?.map((action) => ('command' in action ? action.command : undefined))
          .find((candidate) => candidate?.includes('migration plan'));
        expect(command).toBeDefined();
        const args = (command ?? '').replace(/^\S+ migration plan /, '').split(' ');

        const planned = await runMigrationPlan(ctx, args);
        expect(planned.exitCode, `plan as printed: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        await fillAndApply(ctx, fillUsing('"age"::int4'));

        const rows = await sql(db.connectionString, `SELECT id, age FROM "user"`);
        expect(rows.rows).toEqual([{ id: 1, age: 3 }]);
        await expectSettled(ctx);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: db update --convert with no snapshot of the database contract', () => {
    const db = useDevDatabase();

    it(
      'is refused as needing a migration file, not for want of the origin contract',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, contractWith('  age   String\n'));
        const created = await runDbUpdate(ctx, ['--db', db.connectionString, '--json']);
        expect(created.exitCode, `db update --db: ${created.stderr}`).toBe(0);
        expect(existsSync(join(ctx.testDir, 'migrations', 'snapshots'))).toBe(false);

        await emit(ctx, contractWith('  age   Int\n'));
        const refused = await runDbUpdate(ctx, [
          '--db',
          db.connectionString,
          '--convert',
          'User.age',
          '--json',
        ]);
        expect(engineError(refused)?.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Postgres: db update on a table with rows', () => {
    const db = useDevDatabase();

    it(
      'asks about a lossy type change offering only --delete, casts with it, and gives a new required field a temporary value',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, contractWith('  age   String\n'));
        expect((await runDbUpdate(ctx)).exitCode, 'db update base').toBe(0);
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, email, age) VALUES (1, 'a', '10'), (2, 'b', 'abc')`,
        );

        await emit(ctx, contractWith('  age   Int\n'));
        const asked = await runDbUpdate(ctx, ['--json']);
        expect(engineError(asked)?.code).toBe('CLI.CONSENT_REQUIRED');
        const offered = JSON.stringify(engineError(asked)?.nextActions);
        expect(offered).toContain('--delete User.age');
        expect(offered).not.toContain('--convert');

        const failed = await runDbUpdate(ctx, ['--delete', 'User.age', '--json']);
        expect(engineError(failed)?.code).toBe('MIGRATION.EXECUTION_FAILED');
        expect(JSON.stringify(engineError(failed)?.nextActions)).toContain('--convert User.age');
        await sql(db.connectionString, `UPDATE "user" SET age = '7' WHERE id = 2`);
        const cast = await runDbUpdate(ctx, ['--delete', 'User.age']);
        expect(cast.exitCode, `db update --delete: ${cast.stderr}`).toBe(0);
        expect(
          (await sql(db.connectionString, `SELECT id, age FROM "user" ORDER BY id`)).rows,
        ).toEqual([
          { id: 1, age: 10 },
          { id: 2, age: 7 },
        ]);

        await emit(ctx, contractWith('  age   Int\n  name  String\n'));
        const added = await runDbUpdate(ctx);
        expect(added.exitCode, `db update name: ${added.stderr}`).toBe(0);
        expect(`${added.stdout}${added.stderr}`).toContain(
          `Existing rows got '' in field "User.name". To choose the value, plan a migration with prisma-test migration plan --backfill User.name instead.`,
        );
        expect(
          (await sql(db.connectionString, `SELECT id, name FROM "user" ORDER BY id`)).rows,
        ).toEqual([
          { id: 1, name: '' },
          { id: 2, name: '' },
        ]);
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `db verify: ${verify.stdout}\n${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
