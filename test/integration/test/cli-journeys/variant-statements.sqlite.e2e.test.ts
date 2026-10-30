/**
 * Variant statements on SQLite.
 *
 * `Task` is stored in table `task` and discriminated by `type`. `Bug` is a variant stored in `task`, with its own column `severity`; `Epic` is a variant stored in `task` with its own column `scope`.
 *
 * V1 changes the discriminator value of `Bug` from `bug` to `defect` under `db update`: refused, offering `--convert Bug` first and `--delete Bug` second, then `--convert Bug` rewrites the rows. V2 does the same with `migration plan --convert Bug`, and the `migration.ts` written reproduces itself. V3 removes `Bug`: one question about the model `Bug`, answered by `--delete Bug`, which deletes its rows and drops its column. V4 removes a variant with no fields of its own, so no column: the question about it is answered by `--delete Bug`, which deletes its rows.
 *
 * Every journey ends with `db verify --schema-only` clean and a further plan empty.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
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

function contractWith(bug: string | undefined): string {
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}
${
  bug === undefined
    ? ''
    : `
model Bug {
  severity String?
  @@base(Task, "${bug}")
}
`
}
model Epic {
  scope String?
  @@base(Task, "epic")
}
`;
}

const FROM_PSL = contractWith('bug');
const CHANGED_PSL = contractWith('defect');
const REMOVED_PSL = contractWith(undefined);
const WITHOUT_FIELDS_PSL = FROM_PSL.replace('  severity String?\n', '');

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), FROM_PSL, 'utf-8');
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
    db.exec(
      `INSERT INTO "task" (id, type, severity) VALUES (1, 'bug', 'high'), (2, 'epic', NULL), (3, 'bug', NULL)`,
    );
  });
}

function tasks(dbPath: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare('SELECT id, type FROM "task" ORDER BY id')
      .all()
      .map((row) => ({ ...row })),
  );
}

function columns(dbPath: string): readonly string[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare(`SELECT name FROM pragma_table_info('task') ORDER BY cid`)
      .all()
      .map((row) => String(row['name'])),
  );
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

async function expectSettled(ctx: JourneyContext, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

function nextActionText(result: Parameters<typeof engineError>[0]): string {
  return JSON.stringify(engineError(result)?.nextActions ?? []);
}

withTempDir(({ createTempDir }) => {
  describe('V1 (SQLite): convert a variant whose discriminator value changed, with db update', () => {
    it(
      'is refused offering --convert Bug then --delete Bug, and --convert Bug rewrites the rows',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'V1.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'V1.02: create').toBe(0);
        seedRows(ctx.dbPath);
        await emit(ctx, CHANGED_PSL, 'V1.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'V1.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        const offered = nextActionText(refused);
        expect(offered, 'V1.04: convert offered').toContain('--convert Bug');
        expect(offered, 'V1.04: delete offered').toContain('--delete Bug');
        expect(offered.indexOf('--convert Bug'), 'V1.04: convert first').toBeLessThan(
          offered.indexOf('--delete Bug'),
        );

        const update = await runDbUpdate(ctx, ['--convert', 'Bug', '--no-interactive', '--json']);
        expect(update.exitCode, `V1.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, type: 'defect' },
          { id: 2, type: 'epic' },
          { id: 3, type: 'defect' },
        ]);
        await expectSettled(ctx, 'V1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('V2 (SQLite): convert a variant with migration plan', () => {
    it(
      'writes replaceStoredValue for the variant, and the migration reproduces itself',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'V2.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `V2.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'V2.02: migrate initial').toBe(0);
        seedRows(ctx.dbPath);
        const origin = latestMigrationDirName(ctx);
        await emit(ctx, CHANGED_PSL, 'V2.03');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'defect',
          '--from',
          origin,
          '--convert',
          'Bug',
          '--json',
        ]);
        expect(plan.exitCode, `V2.04: plan: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<{
          operations: readonly { label: string }[];
          appliedStatements: readonly { description: string; operationIndexes: number[] }[];
        }>(plan);
        expect(planned.operations.map(({ label }) => label)).toEqual([
          'Replace value "bug" with "defect" in column "type" of "task"',
        ]);
        expect(planned.appliedStatements).toMatchObject([{ operationIndexes: [0] }]);
        const dirName = latestMigrationDirName(ctx);
        const dir = join(ctx.testDir, 'migrations', 'app', dirName);
        const source = readFileSync(join(dir, 'migration.ts'), 'utf-8');
        expect(source).toContain(
          [
            '      this.replaceStoredValue({',
            "        table: 'task',",
            "        column: 'type',",
            "        from: 'bug',",
            "        to: 'defect',",
            "        codecRef: { codecId: 'sqlite/text@1' },",
            '      }),',
          ].join('\n'),
        );
        const ops = readFileSync(join(dir, 'ops.json'), 'utf-8');
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `V2.05: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        expect(readFileSync(join(dir, 'ops.json'), 'utf-8')).toBe(ops);
        expect((await runMigrate(ctx)).exitCode, 'V2.06: migrate').toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([
          { id: 1, type: 'defect' },
          { id: 2, type: 'epic' },
          { id: 3, type: 'defect' },
        ]);
        await expectSettled(ctx, 'V2.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('V3 (SQLite): remove a variant with db update', () => {
    it(
      'asks one question about the model Bug, and --delete Bug deletes its rows and drops its column',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, FROM_PSL, 'V3.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'V3.02: create').toBe(0);
        seedRows(ctx.dbPath);
        await emit(ctx, REMOVED_PSL, 'V3.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'V3.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        const offered = nextActionText(refused);
        expect(offered, 'V3.04: one flag for the model').toContain('--delete Bug');
        expect(offered, 'V3.04: no question per field').not.toContain('Bug.severity');

        const update = await runDbUpdate(ctx, ['--delete', 'Bug', '--no-interactive', '--json']);
        expect(update.exitCode, `V3.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([{ id: 2, type: 'epic' }]);
        expect(columns(ctx.dbPath)).toEqual(['id', 'scope', 'type']);
        await expectSettled(ctx, 'V3.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('V4 (SQLite): remove a variant with no columns of its own, with db update', () => {
    it(
      'asks one question about the model Bug, and --delete Bug deletes its rows',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, WITHOUT_FIELDS_PSL, 'V4.01');
        expect((await runDbUpdate(ctx, ['--json'])).exitCode, 'V4.02: create').toBe(0);
        withDatabase(ctx.dbPath, (db) => {
          db.exec(`INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic')`);
        });
        await emit(ctx, REMOVED_PSL, 'V4.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'V4.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionText(refused), 'V4.04: one flag for the model').toContain('--delete Bug');

        const update = await runDbUpdate(ctx, ['--delete', 'Bug', '--no-interactive', '--json']);
        expect(update.exitCode, `V4.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(tasks(ctx.dbPath)).toEqual([{ id: 2, type: 'epic' }]);
        expect(columns(ctx.dbPath)).toEqual(['id', 'scope', 'type']);
        await expectSettled(ctx, 'V4.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
