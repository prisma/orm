/**
 * Enum value statements on SQLite.
 *
 * The SQLite twin of `enum-value-statements.e2e.test.ts`. SQLite has no list columns, so `Task` has only the optional `status`, typed by `Status`, whose `ARCHIVED` member stores `archived`.
 *
 * S1 renames the value to `RETIRED`, which stores `retired`, with `--rename Status.ARCHIVED:Status.RETIRED` through `migration plan` and `migrate`. S2 deletes the value through `db update`: refused until `--delete Status.ARCHIVED` answers, then the rows that held it hold NULL.
 *
 * S7 changes the stored value of `ARCHIVED` under `db update` with no migrations, and follows the two-run way the refusal leads with. S8 shifts integer stored values along with two renames in one `db update`.
 *
 * S9 and S10 swap the stored values of `ACTIVE` and `ARCHIVED` under `db update`, with and without migrations. S11 refuses renames that move stored values in a cycle.
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
function twoTablesWith(archived: string): string {
  return `// use prisma-8

enum Status {
  @@type("sqlite/text@1")
  ACTIVE = "active"
  ARCHIVED = "${archived}"
}

model Task {
  id     Int     @id
  status Status?
  @@map("task")
}

model Note {
  id    Int     @id
  state Status?
  @@map("note")
}
`;
}

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

  describe('S4 (SQLite): keep the data of a member that keeps its name with a new stored value, as the question advises', () => {
    it(
      'rewrites the value in both tables the enum types when the advice is followed as printed',
      async () => {
        const ctx = setupSqliteJourney(createTempDir, twoTablesWith('archived'));
        await emit(ctx, twoTablesWith('archived'), 'S4.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `S4.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'S4.02: migrate initial').toBe(0);
        const origin = latestMigrationDirName(ctx);
        withDatabase(ctx.dbPath, (db) => {
          db.exec(
            `INSERT INTO "task" (id, status) VALUES (1, 'archived'), (2, 'active');
             INSERT INTO "note" (id, state) VALUES (1, 'archived')`,
          );
        });
        await emit(ctx, twoTablesWith('old'), 'S4.03');

        const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
        const question = nextActionLabels(asked)[0] ?? '';
        expect(
          question.match(/replace this\.removeStoredValue/g),
          'S4.04: one edit per column',
        ).toHaveLength(2);
        const plan = await runMigrationPlan(ctx, [
          '--name',
          'keep',
          '--from',
          origin,
          '--delete',
          'Status.ARCHIVED',
        ]);
        expect(plan.exitCode, `S4.05: plan: ${plan.stderr}`).toBe(0);
        const dirName = latestMigrationDirName(ctx);
        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(file, followEdits(readFileSync(file, 'utf-8'), question));
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `S4.06: node migration.ts: ${reEmit.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'S4.07: migrate').toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'old' },
          { id: 2, status: 'active' },
        ]);
        expect(
          withDatabase(ctx.dbPath, (db) =>
            db
              .prepare('SELECT id, state FROM "note" ORDER BY id')
              .all()
              .map((row) => ({ ...row })),
          ),
        ).toEqual([{ id: 1, state: 'old' }]);
        await expectVerified(ctx, 'S4.08');
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

  describe('S7 (SQLite): keep the data of a member that keeps its name with a new stored value, through db update alone', () => {
    it(
      'leads the refusal with the two-run way, and following it keeps the rows',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'S7.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'S7.02: create').toBe(0);
        seedRows(ctx.dbPath);
        await emit(ctx, contractWith('  ARCHIVED = "old"\n'), 'S7.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'S7.04').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionLabels(refused), 'S7.04: the way that keeps the data first').toEqual([
          "To keep it with db update, rename member ARCHIVED of enum Status in the contract source to a name the enum does not have, keep its new stored value, run `prisma-test contract emit`, and run `prisma-test db update --rename 'Status.ARCHIVED:Status.<new member>'`. Then rename the member back to ARCHIVED, run `prisma-test contract emit`, and run `prisma-test db update` again.",
          'Run the command again with --delete Status.ARCHIVED',
        ]);
        expect(engineError(refused)?.why, 'S7.04: says plainly what --delete does').toContain(
          'db update cannot keep that data in one run, and --delete Status.ARCHIVED removes it.',
        );

        await emit(ctx, contractWith('  ARCHIVED_NEW = "old"\n'), 'S7.05');
        const first = await runDbUpdate(ctx, [
          '--rename',
          'Status.ARCHIVED:Status.ARCHIVED_NEW',
          '--no-interactive',
          '--json',
        ]);
        expect(first.exitCode, `S7.05: ${JSON.stringify(engineError(first))}`).toBe(0);
        await emit(ctx, contractWith('  ARCHIVED = "old"\n'), 'S7.06');
        const second = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(second.exitCode, `S7.06: ${JSON.stringify(engineError(second))}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'old' },
          { id: 2, status: 'active' },
          { id: 3, status: null },
        ]);
        await expectVerified(ctx, 'S7.07');
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

  const SWAPPED_PSL = FROM_PSL.replace('ACTIVE = "active"', 'ACTIVE = "archived"').replace(
    'ARCHIVED = "archived"',
    'ARCHIVED = "active"',
  );

  async function migratedStart(label: string): Promise<SqliteJourney> {
    const ctx = setupSqliteJourney(createTempDir);
    await emit(ctx, FROM_PSL, `${label}.01`);
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.02: migrate initial`).toBe(0);
    seedRows(ctx.dbPath);
    return ctx;
  }

  describe('S9 (SQLite): keep the data of two members that swap stored values, through the plan db update prints', () => {
    it(
      'offers only the migration plan way, and following it swaps the rows',
      async () => {
        const ctx = await migratedStart('S9');
        await emit(ctx, SWAPPED_PSL, 'S9.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'S9.04').toBe('CLI.CONSENT_REQUIRED');
        const actions = nextActionLabels(refused);
        expect(
          actions.filter((label) => label.startsWith('To keep')).length,
          'S9.04: one way per value, and no two-run way',
        ).toBe(2);
        expect(actions.join('\n')).not.toContain('To keep it with db update');
        const printed = /`prisma-test migration plan (.+?)`/.exec(actions[0] ?? '')?.[1] ?? '';
        expect(printed, 'S9.04: the printed plan deletes both values').toMatch(
          /^--from \S+ --delete Status\.(ACTIVE|ARCHIVED) --delete Status\.(ACTIVE|ARCHIVED)$/,
        );

        const plan = await runMigrationPlan(ctx, ['--name', 'swap', ...printed.split(' ')]);
        expect(plan.exitCode, `S9.05: plan: ${plan.stderr}`).toBe(0);
        const dirName = latestMigrationDirName(ctx);
        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(file, followEdits(readFileSync(file, 'utf-8'), actions.join('\n')));
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `S9.06: node migration.ts: ${reEmit.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'S9.07: migrate').toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, status: 'active' },
          { id: 2, status: 'archived' },
          { id: 3, status: null },
        ]);
        await expectVerified(ctx, 'S9.08');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S10 (SQLite): two members that swap stored values under db update with no migrations', () => {
    it(
      'says plainly that db update cannot keep that data, and offers only the delete',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'S10.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'S10.02: create').toBe(0);
        seedRows(ctx.dbPath);
        await emit(ctx, SWAPPED_PSL, 'S10.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'S10.04').toBe('CLI.CONSENT_REQUIRED');
        expect(engineError(refused)?.why).toContain(
          'db update cannot keep that data, because members of the enum swap stored values, and --delete Status.ACTIVE removes it. Only a migration can keep it, and no migration ends at the contract the database is at.',
        );
        expect(nextActionLabels(refused)).toEqual([
          'Run the command again with --delete Status.ACTIVE',
          'Run the command again with --delete Status.ARCHIVED',
        ]);
        expect(tasks(ctx.dbPath), 'S10.04: nothing changed').toEqual([
          { id: 1, status: 'archived' },
          { id: 2, status: 'active' },
          { id: 3, status: null },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('S11 (SQLite): renames that move stored values in a cycle', () => {
    it(
      'are refused, and the refusal prints the plan to write the rewrites by hand in',
      async () => {
        const ctx = await migratedStart('S11');
        await emit(
          ctx,
          contractWith('  ARCHIVED = "archived"\n')
            .replace('ACTIVE = "active"', 'X = "archived"')
            .replace('ARCHIVED = "archived"', 'Y = "active"'),
          'S11.03',
        );

        const refused = await runDbUpdate(ctx, [
          '--rename',
          'Status.ACTIVE:Status.X',
          '--rename',
          'Status.ARCHIVED:Status.Y',
          '--no-interactive',
          '--json',
        ]);
        expect(engineError(refused)?.code, 'S11.04').toBe('MIGRATION.PLANNING_FAILED');
        expect(nextActionLabels(refused)).toEqual([
          expect.stringMatching(
            /^To write the rewrites by hand, plan the change without --rename Status\.ACTIVE:Status\.X and --rename Status\.ARCHIVED:Status\.Y with `prisma-test migration plan --from \S+`, add the rewrites the message describes to the migration\.ts it writes, run `node <migration directory>\/migration\.ts` for the directory it writes, and apply it with `prisma-test db migrate`$/,
          ),
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
