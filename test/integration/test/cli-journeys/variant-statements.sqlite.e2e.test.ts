/**
 * Variant statements on SQLite.
 *
 * The SQLite twin of `variant-statements.e2e.test.ts`. `Task` is stored in table `task` and discriminated by `type`. `Bug` and `Epic` are its variants. In the shared layout both are stored in `task`, `Bug` with its own column `severity`; in the own-table layout each has its own table, whose foreign key to `task` cascades.
 *
 * - V1: the discriminator value of `Bug` changes from `bug` to `defect`. Without a statement the change is refused, offering `--convert Bug` first and `--delete Bug` second; `--convert Bug` rewrites the rows. Through `migration plan`, `migration.ts` holds the `replaceStoredValue` call.
 * - V2: `Bug` is renamed to `Defect`, whose value is `defect`: `--rename Bug:Defect` rewrites the rows.
 * - V3: the value changes and `--delete Bug` deletes the rows that held it.
 * - V4: `Bug` is removed from the own-table layout: `--delete Bug` drops its table, then deletes its base rows.
 * - V7: in the own-table layout the value of `Bug` changes: `--delete Bug` deletes the rows of its table whose base rows hold the old value, as the cascade of its foreign key would on a database with foreign keys on, then its base rows; its table is kept.
 * - V5: `Bug` is removed from the shared layout: one question about the model `Bug`, and `--delete Bug` deletes its rows and drops its column.
 * - V6: `Bug`, with no fields of its own, is removed: `--delete Bug` deletes its rows.
 *
 * Every journey runs twice: through `migration plan` and `migrate`, whose `migration.ts` is run again and reproduces its `ops.json`, and through `db update`. Each reads the rows back and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

type Via = 'migrate' | 'db update';
const VIAS: readonly Via[] = ['migrate', 'db update'];

interface Variant {
  readonly name: string;
  readonly value: string;
  readonly field?: string;
}

function taskContract(variants: readonly Variant[], ownTables: boolean): string {
  const models = variants.map(
    ({ name, value, field }) => `
model ${name} {
${field === undefined ? '' : `  ${field} String?\n`}  @@base(Task, "${value}")
${ownTables ? `  @@map("${name.toLowerCase()}")\n` : ''}}
`,
  );
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}
${models.join('')}`;
}

const BUG: Variant = { name: 'Bug', value: 'bug', field: 'severity' };
const EPIC: Variant = { name: 'Epic', value: 'epic', field: 'scope' };

const SHARED = taskContract([BUG, EPIC], false);
const CHANGED = taskContract([{ ...BUG, value: 'defect' }, EPIC], false);
const RENAMED = taskContract([{ ...BUG, name: 'Defect', value: 'defect' }, EPIC], false);
const SHARED_REMOVED = taskContract([EPIC], false);
const OWN_TABLES = taskContract([BUG, EPIC], true);
const OWN_TABLES_REMOVED = taskContract([EPIC], true);
const OWN_TABLES_CHANGED = taskContract([{ ...BUG, value: 'defect' }, EPIC], true);
const WITHOUT_FIELDS = taskContract([{ name: 'Bug', value: 'bug' }, EPIC], false);

const SEED_SHARED = `INSERT INTO "task" (id, type, severity) VALUES (1, 'bug', 'high'), (2, 'epic', NULL), (3, 'bug', NULL)`;
const SEED_WITHOUT_FIELDS = `INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic'), (3, 'bug')`;

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
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

function exec(dbPath: string, statement: string): void {
  withDatabase(dbPath, (db) => db.exec(statement));
}

function rows(dbPath: string, query: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare(query)
      .all()
      .map((row) => ({ ...row })),
  );
}

function tasks(dbPath: string): readonly unknown[] {
  return rows(dbPath, 'SELECT id, type FROM "task" ORDER BY id');
}

function columns(dbPath: string, table: string): readonly string[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY name`)
      .all()
      .map((row) => String(row['name'])),
  );
}

function tables(dbPath: string): readonly string[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => String(row['name'])),
  );
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

function fromLatest(ctx: JourneyContext): readonly string[] {
  return getMigrationDirs(ctx).length === 0 ? [] : ['--from', latestMigrationDirName(ctx)];
}

/** Applies the emitted contract through `via`, with the statements given, and checks a written `migration.ts` reproduces its `ops.json`. Returns the `migration.ts` written, if any. */
async function apply(
  ctx: JourneyContext,
  via: Via,
  statements: readonly string[],
  label: string,
): Promise<string | undefined> {
  if (via === 'db update') {
    const update = await runDbUpdate(ctx, [...statements, '--no-interactive', '--json']);
    expect(update.exitCode, `${label}: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
    return undefined;
  }
  const plan = await runMigrationPlan(ctx, [
    ...fromLatest(ctx),
    '--name',
    label.replace(/\W/g, '-'),
    ...statements,
    '--json',
  ]);
  expect(plan.exitCode, `${label}: plan: ${plan.stderr}`).toBe(0);
  const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
  const ops = readFileSync(join(dir, 'ops.json'), 'utf-8');
  const reEmit = await selfEmitMigration(ctx, ['--dir', dir]);
  expect(reEmit.exitCode, `${label}: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
  expect(readFileSync(join(dir, 'ops.json'), 'utf-8'), `${label}: same ops.json`).toBe(ops);
  const migrate = await runMigrate(ctx, ['--json']);
  expect(migrate.exitCode, `${label}: migrate: ${JSON.stringify(engineError(migrate))}`).toBe(0);
  return readFileSync(join(dir, 'migration.ts'), 'utf-8');
}

/** The text of the refusal of the emitted contract without statements. */
async function refusal(ctx: JourneyContext, via: Via, label: string): Promise<string> {
  const refused =
    via === 'db update'
      ? await runDbUpdate(ctx, ['--no-interactive', '--json'])
      : await runMigrationPlan(ctx, [...fromLatest(ctx), '--name', 'refused', '--json']);
  expect(refused.exitCode, `${label}: refused without a statement`).not.toBe(0);
  return JSON.stringify(engineError(refused));
}

async function expectSettled(ctx: JourneyContext, via: Via, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate') {
    const fresh = await runMigrationPlan(ctx, [...fromLatest(ctx), '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

withTempDir(({ createTempDir }) => {
  describe.each(VIAS)(
    'V1 (SQLite, %s): convert a variant whose discriminator value changed',
    (via) => {
      it(
        'is refused offering --convert Bug then --delete Bug, and --convert Bug rewrites the rows',
        async () => {
          const ctx = setupSqliteJourney(createTempDir);
          await emit(ctx, SHARED, 'V1.01');
          await apply(ctx, via, [], 'V1.02');
          exec(ctx.dbPath, SEED_SHARED);
          await emit(ctx, CHANGED, 'V1.03');

          const offered = await refusal(ctx, via, 'V1.04');
          expect(offered, 'V1.04: convert offered').toContain('--convert Bug');
          expect(offered, 'V1.04: delete offered').toContain('--delete Bug');
          expect(offered.indexOf('--convert Bug'), 'V1.04: convert first').toBeLessThan(
            offered.indexOf('--delete Bug'),
          );

          const source = await apply(ctx, via, ['--convert', 'Bug'], 'V1.05');
          if (source !== undefined) {
            expect(source, 'V1.05: migration.ts rewrites the value').toContain(
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
          }
          expect(tasks(ctx.dbPath), 'V1.05: the rows hold the new value').toEqual([
            { id: 1, type: 'defect' },
            { id: 2, type: 'epic' },
            { id: 3, type: 'defect' },
          ]);
          await expectSettled(ctx, via, 'V1.06');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(VIAS)('V2 (SQLite, %s): rename a variant and its discriminator value', (via) => {
    it(
      '--rename Bug:Defect rewrites the rows to the new value',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, SHARED, 'V2.01');
        await apply(ctx, via, [], 'V2.02');
        exec(ctx.dbPath, SEED_SHARED);
        await emit(ctx, RENAMED, 'V2.03');

        await apply(ctx, via, ['--rename', 'Bug:Defect'], 'V2.04');
        expect(
          rows(ctx.dbPath, 'SELECT id, type, severity FROM "task" ORDER BY id'),
          'V2.04: the rows hold the new value and keep their columns',
        ).toEqual([
          { id: 1, type: 'defect', severity: 'high' },
          { id: 2, type: 'epic', severity: null },
          { id: 3, type: 'defect', severity: null },
        ]);
        await expectSettled(ctx, via, 'V2.05');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)(
    'V3 (SQLite, %s): delete the rows of a variant whose value changed',
    (via) => {
      it(
        '--delete Bug deletes the rows that held the old value',
        async () => {
          const ctx = setupSqliteJourney(createTempDir);
          await emit(ctx, SHARED, 'V3.01');
          await apply(ctx, via, [], 'V3.02');
          exec(ctx.dbPath, SEED_SHARED);
          await emit(ctx, CHANGED, 'V3.03');

          await apply(ctx, via, ['--delete', 'Bug'], 'V3.04');
          expect(tasks(ctx.dbPath), 'V3.04: only the other variant is left').toEqual([
            { id: 2, type: 'epic' },
          ]);
          await expectSettled(ctx, via, 'V3.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(VIAS)('V4 (SQLite, %s): remove a variant stored in its own table', (via) => {
    it(
      'asks one question about Bug, and --delete Bug deletes its rows and drops its table',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, OWN_TABLES, 'V4.01');
        await apply(ctx, via, [], 'V4.02');
        exec(
          ctx.dbPath,
          `INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic'), (3, 'bug')`,
        );
        exec(ctx.dbPath, `INSERT INTO "bug" (id, severity) VALUES (1, 'high'), (3, NULL)`);
        exec(ctx.dbPath, `INSERT INTO "epic" (id, scope) VALUES (2, 'all')`);
        await emit(ctx, OWN_TABLES_REMOVED, 'V4.03');

        const offered = await refusal(ctx, via, 'V4.04');
        expect(offered, 'V4.04: one statement for the model').toContain('--delete Bug');
        expect(offered, 'V4.04: no question per field').not.toContain('Bug.severity');

        await apply(ctx, via, ['--delete', 'Bug'], 'V4.05');
        expect(tasks(ctx.dbPath), 'V4.05: its base rows are deleted').toEqual([
          { id: 2, type: 'epic' },
        ]);
        expect(tables(ctx.dbPath), 'V4.05: its table is dropped').not.toContain('bug');
        expect(
          rows(ctx.dbPath, 'SELECT id, scope FROM "epic"'),
          'V4.05: the other variant keeps its rows',
        ).toEqual([{ id: 2, scope: 'all' }]);
        await expectSettled(ctx, via, 'V4.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)(
    'V7 (SQLite, %s): delete the rows of a variant with its own table whose value changed',
    (via) => {
      it(
        '--delete Bug deletes the rows of its table and its base rows, and keeps its table',
        async () => {
          const ctx = setupSqliteJourney(createTempDir);
          await emit(ctx, OWN_TABLES, 'V7.01');
          await apply(ctx, via, [], 'V7.02');
          exec(
            ctx.dbPath,
            `INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic'), (3, 'bug')`,
          );
          exec(ctx.dbPath, `INSERT INTO "bug" (id, severity) VALUES (1, 'high'), (3, NULL)`);
          exec(ctx.dbPath, `INSERT INTO "epic" (id, scope) VALUES (2, 'all')`);
          await emit(ctx, OWN_TABLES_CHANGED, 'V7.03');

          await apply(ctx, via, ['--delete', 'Bug'], 'V7.04');
          expect(tasks(ctx.dbPath), 'V7.04: its base rows are deleted').toEqual([
            { id: 2, type: 'epic' },
          ]);
          expect(rows(ctx.dbPath, 'SELECT id FROM "bug"'), 'V7.04: its table is empty').toEqual([]);
          expect(
            rows(ctx.dbPath, 'SELECT id, scope FROM "epic"'),
            'V7.04: the other variant keeps its rows',
          ).toEqual([{ id: 2, scope: 'all' }]);
          await expectSettled(ctx, via, 'V7.05');
        },
        timeouts.spinUpPpgDev,
      );
    },
  );

  describe.each(VIAS)('V5 (SQLite, %s): remove a variant stored in its base table', (via) => {
    it(
      'asks one question about the model Bug, and --delete Bug deletes its rows and drops its column',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, SHARED, 'V5.01');
        await apply(ctx, via, [], 'V5.02');
        exec(ctx.dbPath, SEED_SHARED);
        await emit(ctx, SHARED_REMOVED, 'V5.03');

        const offered = await refusal(ctx, via, 'V5.04');
        expect(offered, 'V5.04: one statement for the model').toContain('--delete Bug');
        expect(offered, 'V5.04: no question per field').not.toContain('Bug.severity');

        await apply(ctx, via, ['--delete', 'Bug'], 'V5.05');
        expect(tasks(ctx.dbPath), 'V5.05: its rows are deleted').toEqual([{ id: 2, type: 'epic' }]);
        expect(columns(ctx.dbPath, 'task'), 'V5.05: its column is dropped').toEqual([
          'id',
          'scope',
          'type',
        ]);
        await expectSettled(ctx, via, 'V5.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('V6 (SQLite, %s): remove a variant with no columns of its own', (via) => {
    it(
      'asks one question about the model Bug, and --delete Bug deletes its rows',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emit(ctx, WITHOUT_FIELDS, 'V6.01');
        await apply(ctx, via, [], 'V6.02');
        exec(ctx.dbPath, SEED_WITHOUT_FIELDS);
        await emit(ctx, SHARED_REMOVED, 'V6.03');

        expect(await refusal(ctx, via, 'V6.04'), 'V6.04: asked about the model').toContain(
          '--delete Bug',
        );

        await apply(ctx, via, ['--delete', 'Bug'], 'V6.05');
        expect(tasks(ctx.dbPath), 'V6.05: its rows are deleted').toEqual([{ id: 2, type: 'epic' }]);
        expect(columns(ctx.dbPath, 'task'), 'V6.05: no column dropped').toEqual([
          'id',
          'scope',
          'type',
        ]);
        await expectSettled(ctx, via, 'V6.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
