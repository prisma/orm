/**
 * The advice printed when a field becomes required while rows have no value for it (Postgres),
 * followed as printed to an applied migration.
 *
 * Under `db migrate`, a migration that adds two required enum fields to a table with rows fails;
 * the advice names a backfill for both, and planning again with it applies. `db update`, after the
 * project applied its migrations with `db migrate` (so the `db` ref is stale), plans the backfill
 * from the contract the database is at. `db init` on a table with rows says to initialize with the
 * field optional and make it required with `db update`.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  injectMigrationSqlDbSetup,
  type JourneyContext,
  latestMigrationDirName,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const ENUMS = `
enum Role {
  @@type("pg/text@1")
  Admin = "admin"
  Member = "member"
}

enum Tier {
  @@type("pg/text@1")
  Free = "free"
  Paid = "paid"
}
`;

function contractWith(fields: string, extra = ''): string {
  return `// use prisma-8

model User {
  id    Int    @id
  email String
${fields}
  @@map("user")
}
${extra}`;
}

async function emit(ctx: JourneyContext, psl: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);
}

async function migrated(ctx: JourneyContext): Promise<void> {
  expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
  const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(initial.exitCode, `plan initial: ${initial.stderr}`).toBe(0);
  const applied = await runMigrate(ctx);
  expect(applied.exitCode, `apply initial: ${applied.stderr}`).toBe(0);
}

function adviceOf(result: Parameters<typeof engineError>[0]): string {
  return (engineError(result)?.nextActions ?? []).map(({ label }) => label).join('\n');
}

/** The `migration plan` arguments an advice prints, as a shell would split them. */
function printedPlan(advice: string): readonly string[] {
  const command = /`\S+ migration plan ([^`]+)`/.exec(advice)?.[1];
  expect(command, advice).toBeDefined();
  return (command ?? '').split(' ');
}

/** Fills each field's backfill slots with an update to `value` where it is NULL, and applies. */
async function fillBackfillsAndApply(
  ctx: JourneyContext,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const migrationDir = join(ctx.testDir, 'migrations', 'app', latestMigrationDirName(ctx));
  const migrationTs = join(migrationDir, 'migration.ts');
  let filled = injectMigrationSqlDbSetup(readFileSync(migrationTs, 'utf-8'));
  for (const [field, value] of Object.entries(values)) {
    filled = filled
      .replace(
        `() => placeholder('User.${field}:check')`,
        `() => db.public.user.select('id').where((f, fns) => fns.eq(f.${field}, null)).limit(1)`,
      )
      .replace(
        `() => placeholder('User.${field}:run')`,
        `() => db.public.user.update({ ${field}: '${value}' }).where((f, fns) => fns.eq(f.${field}, null))`,
      );
  }
  expect(filled).not.toContain('placeholder(');
  writeFileSync(migrationTs, filled);
  const emitted = await selfEmitMigration(ctx, ['--dir', migrationDir, '--config', ctx.configPath]);
  expect(emitted.exitCode, `self-emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
  const applied = await runMigrate(ctx);
  expect(applied.exitCode, `apply: ${applied.stdout}\n${applied.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('db migrate: two new required fields on a table with rows', () => {
    const db = useDevDatabase();

    it(
      'names a backfill for both fields, and planning again with it applies',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx);
        await sql(db.connectionString, `INSERT INTO "user" (id, email) VALUES (1, 'a'), (2, 'b')`);

        await emit(ctx, contractWith('  role  Role\n  tier  Tier\n', ENUMS));
        const planned = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'roles',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
        const failed = await runMigrate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const advice = adviceOf(failed);
        const directory = /delete `([^`]+)`/.exec(advice)?.[1];
        expect(directory, advice).toBeDefined();
        const args = printedPlan(advice);
        expect(args).toEqual(expect.arrayContaining(['--backfill', 'User.role', 'User.tier']));

        rmSync(resolve(ctx.testDir, directory ?? ''), { recursive: true });
        const replanned = await runMigrationPlan(ctx, args);
        expect(replanned.exitCode, `plan as printed: ${replanned.stderr}`).toBe(0);
        await fillBackfillsAndApply(ctx, { role: 'member', tier: 'free' });

        const rows = await sql(
          db.connectionString,
          `SELECT id, role, tier FROM "user" ORDER BY id`,
        );
        expect(rows.rows).toEqual([
          { id: 1, role: 'member', tier: 'free' },
          { id: 2, role: 'member', tier: 'free' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update after db migrate: a field made required', () => {
    const db = useDevDatabase();

    it(
      'plans the backfill from the contract the database is at, though the db ref is stale',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await migrated(ctx);
        await emit(ctx, contractWith('  nick  String?\n'));
        const optional = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'nick',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(optional.exitCode, `plan nick: ${optional.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'apply nick').toBe(0);
        await sql(
          db.connectionString,
          `INSERT INTO "user" (id, email, nick) VALUES (1, 'a', NULL), (2, 'b', 'bo')`,
        );

        await emit(ctx, contractWith('  nick  String\n'));
        const refused = await runDbUpdate(ctx, ['--backfill', 'User.nick', '--json']);
        expect(engineError(refused)?.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        const marker = await sql(
          db.connectionString,
          'SELECT core_hash FROM prisma_contract.marker',
        );
        const markerHash = String(marker.rows[0]?.['core_hash']).replace(/^sha256:/, '');
        expect(JSON.stringify(engineError(refused)?.nextActions)).toContain(
          `migration plan --from ${markerHash} --backfill User.nick`,
        );

        const failed = await runDbUpdate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        expect(engineError(failed)?.summary).toBe(
          '1 row of "user" holds NULL in "nick", so it cannot become required.',
        );
        const replanned = await runMigrationPlan(ctx, printedPlan(adviceOf(failed)));
        expect(replanned.exitCode, `plan as printed: ${replanned.stderr}`).toBe(0);
        await fillBackfillsAndApply(ctx, { nick: 'anon' });

        const rows = await sql(db.connectionString, `SELECT id, nick FROM "user" ORDER BY id`);
        expect(rows.rows).toEqual([
          { id: 1, nick: 'anon' },
          { id: 2, nick: 'bo' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db init on a table with rows: a new required field', () => {
    const db = useDevDatabase();

    it(
      'says to initialize with the field optional, then db update says how to fill it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await sql(
          db.connectionString,
          `CREATE TABLE "user" (id int4 PRIMARY KEY, email text NOT NULL);
           INSERT INTO "user" (id, email) VALUES (1, 'a'), (2, 'b')`,
        );

        await emit(ctx, contractWith('  role  Role\n', ENUMS));
        const failed = await runDbInit(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        expect(adviceOf(failed)).toContain(
          'Make field "User.role" optional in the contract source, run `prisma-test db init`, then make it required with',
        );

        await emit(ctx, contractWith('  role  Role?\n', ENUMS));
        const initialized = await runDbInit(ctx);
        expect(initialized.exitCode, `db init: ${initialized.stderr}`).toBe(0);

        await emit(ctx, contractWith('  role  Role\n', ENUMS));
        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode).not.toBe(0);
        const replanned = await runMigrationPlan(ctx, printedPlan(adviceOf(update)));
        expect(replanned.exitCode, `plan as printed: ${replanned.stderr}`).toBe(0);
        await fillBackfillsAndApply(ctx, { role: 'admin' });

        const rows = await sql(db.connectionString, `SELECT id, role FROM "user" ORDER BY id`);
        expect(rows.rows).toEqual([
          { id: 1, role: 'admin' },
          { id: 2, role: 'admin' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update: a new required unique field on a table with rows', () => {
    const db = useDevDatabase();

    it(
      'offers no default, which one value in every row would break, and its --backfill route applies',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, contractWith(''));
        await migrated(ctx);
        await sql(db.connectionString, `INSERT INTO "user" (id, email) VALUES (1, 'a')`);

        await emit(ctx, contractWith('  slug  String @unique\n'));
        const failed = await runDbUpdate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const advice = adviceOf(failed);
        expect(advice).not.toContain('default');
        expect(advice).toContain('Make the field optional in the contract source');

        const replanned = await runMigrationPlan(ctx, printedPlan(advice));
        expect(replanned.exitCode, `plan as printed: ${replanned.stderr}`).toBe(0);
        await fillBackfillsAndApply(ctx, { slug: 'first' });

        const rows = await sql(db.connectionString, `SELECT id, slug FROM "user" ORDER BY id`);
        expect(rows.rows).toEqual([{ id: 1, slug: 'first' }]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update --backfill when the database cannot be reached', () => {
    it(
      'refuses the statement and names migration plan without --from',
      async () => {
        const ctx = setupJourney({
          connectionString: 'postgresql://postgres:postgres@localhost:1/unreachable',
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, contractWith('  nick  String\n'));
        const refused = await runDbUpdate(ctx, ['--backfill', 'User.nick', '--json']);
        expect(engineError(refused)?.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        expect(JSON.stringify(engineError(refused)?.nextActions)).toContain(
          'migration plan --backfill User.nick',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
