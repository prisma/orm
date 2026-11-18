/**
 * Enum value statements on SQLite.
 *
 * The SQLite twin of `enum-value-statements.e2e.test.ts`. SQLite has no list columns, so `Task` has only the optional `status`, typed by `Status`, whose `ARCHIVED` member stores `archived`.
 *
 * S1 renames the value to `RETIRED`, which stores `retired`, with `--rename Status.ARCHIVED:Status.RETIRED` through `migration plan` and `migrate`. S2 deletes the value through `db update`: refused until `--delete Status.ARCHIVED` answers, then the rows that held it hold NULL.
 *
 * S8 shifts integer stored values along with two renames in one `db update`. S11 refuses renames that move stored values in a cycle, and follows the two plans the refusal leads with. A member that keeps its name while its stored value changes is in `enum-stored-values.sqlite.e2e.test.ts`.
 *
 * S3 has a required `status`: with no row holding the value, `--delete` removes it; while rows hold it, `--delete` fails at apply with `MIGRATION.PRECHECK_FAILED` saying how to keep them and changes nothing, and `--rename` applies.
 *
 * Every journey ends with `db verify --schema-only` clean and a further plan empty, and the `migration.ts` written is run again and reproduces its `ops.json` and `migration.json` byte for byte.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';
import { followEdits } from '../utils/stored-value-edits';

function contractWith(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
  ACTIVE = "active"
${members}}

model Task {
  id     Int     @id
  status Status?
  @@map("task")
}
`;
}

const FROM_PSL = contractWith('  ARCHIVED = "archived"\n');
const RENAMED_PSL = contractWith('  RETIRED = "retired"\n');
const REMOVED_PSL = contractWith('');
function nextActionLabels(result: Parameters<typeof engineError>[0]): readonly string[] {
  return (engineError(result)?.nextActions ?? []).map(({ label }) => label);
}

const required = (psl: string) => psl.replace('status Status?', 'status Status ');

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string, psl = FROM_PSL): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), psl, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function withDatabase<T>(dbPath: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function seedRows(dbPath: string): void {
  withDatabase(dbPath, (db) => {
    db.exec(`INSERT INTO "task" (id, status) VALUES (1, 'archived'), (2, 'active'), (3, NULL)`);
  });
}

function tasks(dbPath: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare('SELECT id, status FROM "task" ORDER BY id')
      .all()
      .map((row) => ({ ...row })),
  );
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

async function expectVerified(ctx: JourneyContext, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('S1 (SQLite): rename an enum value with migration plan', () => {
    it(
      'rewrites the rows that hold the old value, and the migration reproduces itself',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'S1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `S1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `S1.02: migrate initial: ${applyInitial.stderr}`).toBe(0);
        seedRows(ctx.dbPath);
        const origin = latestMigrationDirName(ctx);
        await emit(ctx, RENAMED_PSL, 'S1.03');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'retire',
          '--from',
          origin,
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
          '--json',
        ]);
        expect(plan.exitCode, `S1.04: plan: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<{
          operations: readonly { label: string }[];
          appliedStatements: readonly { description: string; operationIndexes: number[] }[];
        }>(plan);
        expect(planned.operations.map(({ label }) => label)[0]).toBe(
          'Replace value "archived" with "retired" in column "status" of "task"',
        );
        expect(planned.appliedStatements).toMatchObject([
          {
            description: 'rename enum value "Status.ARCHIVED" to "Status.RETIRED"',
            operationIndexes: [0],
          },
        ]);
        const dirName = latestMigrationDirName(ctx);
        const written = packageFiles(ctx, dirName);
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `S1.05: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        expect(packageFiles(ctx, dirName)).toEqual(written);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `S1.06: migrate: ${migrate.stderr}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'retired' },
          { id: 2, status: 'active' },
          { id: 3, status: null },
        ]);
        await expectVerified(ctx, 'S1.07');
        const count = getMigrationDirs(ctx).length;
        const fresh = await runMigrationPlan(ctx, ['--from', dirName, '--json']);
        expect(fresh.exitCode, `S1.08: plan with no change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'S1.08: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'S1.08: nothing written').toHaveLength(count);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S2 (SQLite): delete an enum value with db update', () => {
    it(
      'is refused until --delete names the value, then sets the rows that hold it to NULL',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'S2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S2.02: db update creates the table: ${create.stderr}`).toBe(0);
        seedRows(ctx.dbPath);
        await emit(ctx, REMOVED_PSL, 'S2.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'S2.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(
          JSON.stringify(engineError(refused)?.nextActions ?? []),
          'S2.04: one flag for the value',
        ).toContain('--delete Status.ARCHIVED');

        const update = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `S2.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: null },
          { id: 2, status: 'active' },
          { id: 3, status: null },
        ]);
        await expectVerified(ctx, 'S2.06');
        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `S2.07: db update --dry-run: ${dryRun.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
          'S2.07: nothing left to plan',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S3 (SQLite): delete an enum value a required column types', () => {
    it(
      'removes it when no row holds it; while rows do, fails at apply and changes nothing, and a rename applies',
      async () => {
        const empty = setupSqliteJourney(createTempDir, required(FROM_PSL));
        await emit(empty, required(FROM_PSL), 'S3.01');
        expect((await runDbUpdate(empty, ['--json'])).exitCode, 'S3.02: create').toBe(0);
        await emit(empty, required(REMOVED_PSL), 'S3.03');
        const removed = await runDbUpdate(empty, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(removed.exitCode, `S3.04: ${JSON.stringify(engineError(removed))}`).toBe(0);
        await expectVerified(empty, 'S3.05');

        const held = setupSqliteJourney(createTempDir, required(FROM_PSL));
        await emit(held, required(FROM_PSL), 'S3.06');
        expect((await runDbUpdate(held, ['--json'])).exitCode, 'S3.07: create').toBe(0);
        withDatabase(held.dbPath, (db) => {
          db.exec(`INSERT INTO "task" (id, status) VALUES (1, 'archived'), (2, 'active')`);
        });
        await emit(held, required(REMOVED_PSL), 'S3.08');
        const failed = await runDbUpdate(held, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(engineError(failed)?.code, 'S3.09').toBe('MIGRATION.PRECHECK_FAILED');
        expect({
          summary: engineError(failed)?.summary,
          actions: (engineError(failed)?.nextActions ?? []).map(({ label }) => label),
        }).toEqual({
          summary:
            '1 row of "task" holds "archived" in column "status", which takes no NULL, so the value cannot be removed.',
          actions: [
            'To keep that data under a new enum value, add a member to enum "Status" in the contract source, run `prisma-test contract emit`, then run `prisma-test db update --rename \'Status.ARCHIVED:Status.<new member>\'`',
            'To keep that data under another stored value, change the stored value "archived" to one the enum keeps in the database yourself, then re-run `prisma-test db update --delete Status.ARCHIVED`',
          ],
        });
        expect(tasks(held.dbPath), 'S3.09: nothing changed').toEqual([
          { id: 1, status: 'archived' },
          { id: 2, status: 'active' },
        ]);
        await emit(held, required(RENAMED_PSL), 'S3.10');
        const renamed = await runDbUpdate(held, [
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
          '--no-interactive',
          '--json',
        ]);
        expect(renamed.exitCode, `S3.11: ${JSON.stringify(engineError(renamed))}`).toBe(0);
        expect(tasks(held.dbPath)).toEqual([
          { id: 1, status: 'retired' },
          { id: 2, status: 'active' },
        ]);
        await expectVerified(held, 'S3.12');
      },
      timeouts.spinUpPpgDev,
    );
  });

  /** A migrated project whose next migration removes `ARCHIVED` while a row of the required column holds it. */
  async function failedMigration(label: string) {
    const ctx = setupSqliteJourney(createTempDir, required(FROM_PSL));
    await emit(ctx, required(FROM_PSL), `${label}.01`);
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.02: migrate initial`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    withDatabase(ctx.dbPath, (db) => {
      db.exec(`INSERT INTO "task" (id, status) VALUES (1, 'archived'), (2, 'active')`);
    });
    await emit(ctx, required(REMOVED_PSL), `${label}.03`);
    const plan = await runMigrationPlan(ctx, [
      '--name',
      'retire',
      '--from',
      origin,
      '--delete',
      'Status.ARCHIVED',
      '--json',
    ]);
    expect(plan.exitCode, `${label}.04: plan: ${plan.stderr}`).toBe(0);
    const failed = await runMigrate(ctx, ['--json']);
    expect(engineError(failed)?.code, `${label}.05`).toBe('MIGRATION.PRECHECK_FAILED');
    return { ctx, failed, dirName: latestMigrationDirName(ctx) };
  }

  describe('S5 (SQLite): keep the data of a required column by hand in migration.ts, as db migrate advises', () => {
    it(
      'makes the printed edit, runs the file, and migrates',
      async () => {
        const { ctx, failed, dirName } = await failedMigration('S5');
        const byHand = nextActionLabels(failed)[1] ?? '';
        expect(byHand).toContain(`in \`migrations/app/${dirName}/migration.ts\``);
        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(
          file,
          followEdits(
            readFileSync(file, 'utf-8'),
            byHand.replaceAll("'<stored value>'", "'active'"),
          ),
        );
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `S5.06: node migration.ts: ${reEmit.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'S5.07: migrate').toBe(0);
        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'active' },
          { id: 2, status: 'active' },
        ]);
        await expectVerified(ctx, 'S5.08');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S6 (SQLite): keep the data of a required column under a new member, as db migrate advises', () => {
    it(
      'deletes the written migration, plans it again with the printed command and a rename, and migrates',
      async () => {
        const { ctx, failed, dirName } = await failedMigration('S6');
        const rename = nextActionLabels(failed)[0] ?? '';
        expect(rename).toContain(`delete \`migrations/app/${dirName}\``);
        const printed =
          /`prisma-test migration plan (--from \S+ --name \S+) --rename/.exec(rename)?.[1] ?? '';
        expect(printed, 'S6.05: the printed plan').not.toBe('');

        await emit(ctx, required(RENAMED_PSL), 'S6.06');
        rmSync(join(ctx.testDir, 'migrations', 'app', dirName), { recursive: true });
        const plan = await planMigrationAndSelfEmit(ctx, [
          ...printed.split(' '),
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
        ]);
        expect(plan.exitCode, `S6.07: plan again: ${plan.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'S6.08: migrate').toBe(0);
        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'retired' },
          { id: 2, status: 'active' },
        ]);
        await expectVerified(ctx, 'S6.09');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S8 (SQLite): renames that shift integer stored values along', () => {
    const prio = (members: string) => `// use prisma-8

enum Prio {
  @@type("sqlite/integer@1")
${members}}

model Job {
  id   Int   @id
  prio Prio?
  @@map("job")
}
`;

    it(
      'rewrite the last value first, so no row ends up merged',
      async () => {
        const ctx = setupSqliteJourney(createTempDir, prio('  Low = 0\n  Higher = 3\n  Max = 4\n'));
        await emit(ctx, prio('  Low = 0\n  Higher = 3\n  Max = 4\n'), 'S8.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'S8.02: create').toBe(0);
        withDatabase(ctx.dbPath, (db) => {
          db.exec('INSERT INTO "job" (id, prio) VALUES (1, 0), (2, 3), (3, 4)');
        });
        await emit(ctx, prio('  Low = 0\n  A = 4\n  B = 5\n'), 'S8.03');

        const update = await runDbUpdate(ctx, [
          '--rename',
          'Prio.Higher:Prio.A',
          '--rename',
          'Prio.Max:Prio.B',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `S8.04: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(
          withDatabase(ctx.dbPath, (db) =>
            db
              .prepare('SELECT id, prio FROM "job" ORDER BY id')
              .all()
              .map((row) => ({ ...row })),
          ),
        ).toEqual([
          { id: 1, prio: 0 },
          { id: 2, prio: 4 },
          { id: 3, prio: 5 },
        ]);
        await expectVerified(ctx, 'S8.05');
      },
      timeouts.spinUpPpgDev,
    );
  });

  async function migratedStart(label: string): Promise<SqliteJourney> {
    const ctx = setupSqliteJourney(createTempDir);
    await emit(ctx, FROM_PSL, `${label}.01`);
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.02: migrate initial`).toBe(0);
    seedRows(ctx.dbPath);
    return ctx;
  }

  describe('S11 (SQLite): renames that move stored values in a cycle', () => {
    it(
      'are refused, and the two plans the refusal leads with swap the rows',
      async () => {
        const ctx = await migratedStart('S11');
        const cycle = (x: string) =>
          contractWith('  ARCHIVED = "archived"\n')
            .replace('ACTIVE = "active"', `X = "${x}"`)
            .replace('ARCHIVED = "archived"', 'Y = "active"');
        const renames = [
          '--rename',
          'Status.ACTIVE:Status.X',
          '--rename',
          'Status.ARCHIVED:Status.Y',
        ];
        await emit(ctx, cycle('archived'), 'S11.03');

        const refused = await runDbUpdate(ctx, [...renames, '--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'S11.04').toBe('MIGRATION.PLANNING_FAILED');
        expect(nextActionLabels(refused), 'S11.04: two plans first, by hand second').toEqual([
          'The plan rewrites a changed stored value in every row that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Status.X" a stored value no member stores, such as "prisma_swap", and give "Status.Y" the stored value "active", and plan and apply that with the same statements; then give "Status.X" the stored value "archived", and plan again without them. With migration plan, you can instead leave out the renames in the cycle, and in the migration.ts a plan without them writes, rewrite the values in each column the enum types through a value no member stores, "active" to "prisma_swap", then "archived" to "active", then "prisma_swap" to "archived", each with this.replaceStoredValue({ table, column, from, to }).',
          expect.stringMatching(
            /^To write the rewrites by hand, plan the change without --rename Status\.ACTIVE:Status\.X and --rename Status\.ARCHIVED:Status\.Y with `prisma-test migration plan --from \S+`, add the rewrites the message describes to the migration\.ts it writes, run `node <migration directory>\/migration\.ts` for the directory it writes, and apply it with `prisma-test db migrate`$/,
          ),
        ]);

        await emit(ctx, cycle('prisma_swap'), 'S11.05');
        const first = await runDbUpdate(ctx, [...renames, '--no-interactive', '--json']);
        expect(first.exitCode, `S11.05: plan 1, with the statements: ${first.stderr}`).toBe(0);
        await emit(ctx, cycle('archived'), 'S11.06');
        const second = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(second.exitCode, `S11.06: plan 2, without them: ${second.stderr}`).toBe(0);
        expect(tasks(ctx.dbPath), 'S11.07: each row keeps its member under its new name').toEqual([
          { id: 1, status: 'active' },
          { id: 2, status: 'archived' },
          { id: 3, status: null },
        ]);
        await expectVerified(ctx, 'S11.08');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
