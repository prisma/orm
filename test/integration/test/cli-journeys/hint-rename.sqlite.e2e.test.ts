/**
 * Renaming a model with a rename hint keeps its table's rows (SQLite).
 *
 * The SQLite twin of `hint-rename.e2e.test.ts`, driven through a file database and the SQLite PSL
 * config. The seeded `Profile` table has rows, a default primary key, a unique constraint, a
 * foreign key to `Account`, a foreign key from `Post` and a secondary index; SQLite has no check
 * constraints and no row-level security. The schema change renames the model to `Member` and adds
 * `@@hint(was: "Profile")`. SQLite cannot rename an index, so the rename drops each index named
 * after the old table and creates it under the new name.
 *
 * Journey H1 plans the change with `migration plan` and applies it with `migrate`; journey H2
 * applies it with `db update`, which asks for no consent; journey H3 keeps the spent hint in the
 * schema; journey H4 names, as the old table, a table that still exists beside the new one.
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
  type PslContractVariant,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  sqlitePslConfigFixture,
  swapPslContract,
  timeouts,
} from '../utils/journey-test-helpers';

const HINT_TEXT =
  'rename hint on table "Member" (was "Profile"): renamed and recorded in this migration; you can remove the hint.';

const RENAME_CALL = "...this.renameTable({ table: 'Profile', to: 'Member' })";

const RENAME_OPERATIONS = [
  { label: 'Rename table Profile to Member', operationClass: 'widening' },
  { label: 'Drop index Profile_accountId_idx_cbfb3085 on Member', operationClass: 'widening' },
  { label: 'Drop index Profile_handle_idx_b5b249e4 on Member', operationClass: 'widening' },
  { label: 'Create index Member_accountId_idx_cbfb3085 on Member', operationClass: 'additive' },
  { label: 'Create index Member_handle_idx_b5b249e4 on Member', operationClass: 'additive' },
];

type Operation = { readonly label: string; readonly operationClass: string };

interface PlanDocument {
  readonly noOp: boolean;
  readonly operations: readonly Operation[];
  readonly consumedHints?: readonly { readonly text: string }[];
}

interface UpdateDocument {
  readonly plan: { readonly operations: readonly Operation[] };
}

type SqliteJourneyContext = JourneyContext & { readonly dbPath: string };

function setupSqliteJourney(createTempDir: () => string): SqliteJourneyContext {
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

const byLabel = (a: Operation, b: Operation) => a.label.localeCompare(b.label);

function operationsOf(plan: readonly Operation[]): readonly Operation[] {
  return plan.map(({ label, operationClass }) => ({ label, operationClass }));
}

async function seedProfile(
  ctx: SqliteJourneyContext,
  label: string,
  apply: 'migrate' | 'db update',
  variant: PslContractVariant = 'contract-hint-rename-sqlite-from',
): Promise<void> {
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}.01: emit Profile: ${emit.stderr}`).toBe(0);
  if (apply === 'migrate') {
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    const applyInitial = await runMigrate(ctx);
    expect(applyInitial.exitCode, `${label}.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
  } else {
    const create = await runDbUpdate(ctx, ['--json']);
    expect(create.exitCode, `${label}.02: db update creates Profile: ${create.stderr}`).toBe(0);
  }
  withDatabase(ctx.dbPath, (db) => {
    db.exec(
      `INSERT INTO "Account" (id) VALUES (1);
       INSERT INTO "Profile" (id, email, handle, "accountId")
       VALUES (1, 'alice@example.com', 'alice', 1), (2, 'bob@example.com', 'bob', 1);
       INSERT INTO "Post" (id, "profileId") VALUES (10, 1)`,
    );
  });
}

async function emitHinted(ctx: SqliteJourneyContext, label: string): Promise<void> {
  swapPslContract(ctx, 'contract-hint-rename-sqlite-to');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit Member with the hint: ${emit.stderr}`).toBe(0);
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    opsJson: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migrationJson: readFileSync(join(dir, 'migration.json'), 'utf-8'),
  };
}

function operationsBlock(ctx: JourneyContext, dirName: string): string {
  const source = readFileSync(
    join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts'),
    'utf-8',
  );
  const match = /get operations\(\)[^[]*\[([\s\S]*?)\];/.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`migration.ts has no operations array:\n${source}`);
  }
  return match[1].trim().replace(/,$/, '');
}

async function expectRenamed(ctx: SqliteJourneyContext, label: string): Promise<void> {
  const state = withDatabase(ctx.dbPath, (db) => ({
    rows: db.prepare(`SELECT id, email FROM "Member" ORDER BY id`).all(),
    tables: db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => row['name'])
      .filter((name) => !/^(_prisma|sqlite_)/.test(String(name))),
    objects: db
      .prepare(`SELECT type, name FROM sqlite_master WHERE tbl_name = 'Member' ORDER BY type, name`)
      .all()
      .map((row) => `${row['type']} ${row['name']}`),
    memberForeignKeys: db
      .prepare(`PRAGMA foreign_key_list("Member")`)
      .all()
      .map((row) => `${row['from']}->${row['table']}`),
    postForeignKeys: db
      .prepare(`PRAGMA foreign_key_list("Post")`)
      .all()
      .map((row) => `${row['from']}->${row['table']}`),
  }));
  expect(state, `${label}: rows and objects under the new name`).toEqual({
    rows: [
      { id: 1, email: 'alice@example.com' },
      { id: 2, email: 'bob@example.com' },
    ],
    tables: ['Account', 'Member', 'Post'],
    objects: [
      'index Member_accountId_idx_cbfb3085',
      'index Member_handle_idx_b5b249e4',
      'index sqlite_autoindex_Member_1',
      'table Member',
    ],
    memberForeignKeys: ['accountId->Account'],
    postForeignKeys: ['profileId->Member'],
  });
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey H1 (SQLite): rename a model with a rename hint through migration plan', () => {
    it(
      'plans only the hinted rename, reports the hint, keeps the rows and objects, and leaves nothing to plan',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await seedProfile(ctx, 'H1', 'migrate');
        await emitHinted(ctx, 'H1.04');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan.exitCode, `H1.05: plan the rename: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<PlanDocument>(plan);
        const plannedFiles = packageFiles(ctx, latestMigrationDirName(ctx));
        const reEmit = await selfEmitMigration(ctx, [
          '--dir',
          `migrations/app/${latestMigrationDirName(ctx)}`,
        ]);
        expect(reEmit.exitCode, `H1.05: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        expect(
          packageFiles(ctx, latestMigrationDirName(ctx)),
          'H1.05: re-running migration.ts writes the same ops.json and migration.json as the plan',
        ).toEqual(plannedFiles);
        expect(
          JSON.parse(plannedFiles.opsJson).map((op: { readonly label: string }) => op.label),
          'H1.05: the planned ops.json holds the rename',
        ).toContain(planned.operations[0]?.label);
        expect(planned.consumedHints, 'H1.05: the plan reports the hint it used').toEqual([
          { hint: expect.objectContaining({ kind: 'renamed', from: 'Profile' }), text: HINT_TEXT },
        ]);
        expect(
          operationsOf(planned.operations),
          'H1.05: the rename, then each index named after the old table dropped and recreated',
        ).toEqual(RENAME_OPERATIONS);
        expect(
          operationsBlock(ctx, latestMigrationDirName(ctx)),
          'H1.05: migration.ts holds only the renameTable call',
        ).toBe(RENAME_CALL);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `H1.06: migrate: ${apply.stderr}`).toBe(0);
        await expectRenamed(ctx, 'H1.07');

        const migrationCount = getMigrationDirs(ctx).length;
        const followUp = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(followUp.exitCode, `H1.08: follow-up plan: ${followUp.stderr}`).toBe(0);
        expect(parseJsonOutput<PlanDocument>(followUp).noOp, 'H1.08: nothing to plan').toBe(true);
        expect(getMigrationDirs(ctx), 'H1.08: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H2 (SQLite): rename a model with a rename hint through db update', () => {
    it(
      'renames without asking for consent, reaches the same state, and plans nothing on a second run',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await seedProfile(ctx, 'H2', 'db update');
        await emitHinted(ctx, 'H2.03');

        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode, `H2.04: db update without --confirm: ${update.stderr}`).toBe(0);
        expect(engineError(update), 'H2.04: no consent refusal').toBeUndefined();
        const operations = operationsOf(parseJsonOutput<UpdateDocument>(update).plan.operations);
        expect(operations[0], 'H2.04: db update renames the table first').toEqual(
          RENAME_OPERATIONS[0],
        );
        expect(
          operations.slice(1, 3).every((op) => op.label.startsWith('Drop index')),
          'H2.04: then drops the indexes named after the old table',
        ).toBe(true);
        expect(
          [...operations].sort(byLabel),
          'H2.04: the same operations as the planned migration, in the introspected index order',
        ).toEqual([...RENAME_OPERATIONS].sort(byLabel));
        await expectRenamed(ctx, 'H2.05');

        const again = await runDbUpdate(ctx, ['--json']);
        expect(again.exitCode, `H2.06: second db update: ${again.stderr}`).toBe(0);
        expect(
          parseJsonOutput<UpdateDocument>(again).plan.operations,
          'H2.06: nothing to plan',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H3 (SQLite): a spent rename hint', () => {
    it(
      'prints Hints applied for the rename, then plans nothing and prints no block while the hint stays',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await seedProfile(ctx, 'H3', 'migrate');
        await emitHinted(ctx, 'H3.04');

        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan.exitCode, `H3.05: plan the rename: ${plan.stderr}`).toBe(0);
        expect(plan.stderr, 'H3.05: the rename plan prints the block').toContain('Hints applied');
        expect(plan.stderr, 'H3.05: and the hint line').toContain(HINT_TEXT);
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `H3.06: migrate: ${apply.stderr}`).toBe(0);

        const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
        expect(contract.hints, 'H3.07: the emitted contract still carries the hint').toEqual({
          namespaces: { __unbound__: { tables: { Member: { was: 'Profile' } } } },
        });
        const spent = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx)]);
        expect(spent.exitCode, `H3.07: plan with the spent hint: ${spent.stderr}`).toBe(0);
        expect(spent.stderr, 'H3.07: nothing to plan').toContain('No changes detected');
        expect(spent.stderr, 'H3.07: no Hints applied block').not.toContain('Hints applied');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H4 (SQLite): a rename hint whose old table still exists', () => {
    it(
      'fails migration plan with MIGRATION.HINT_CONTRADICTED and writes nothing',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await seedProfile(ctx, 'H4', 'migrate', 'contract-hint-rename-sqlite-both');
        await emitHinted(ctx, 'H4.04');

        const migrationCount = getMigrationDirs(ctx).length;
        const plan = await runMigrationPlan(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan.exitCode, 'H4.05: the plan is refused').not.toBe(0);
        const error = engineError(plan);
        expect(error?.code, 'H4.05: planning failed').toBe('MIGRATION.PLANNING_FAILED');
        expect(error?.why, 'H4.05: the hint is contradicted').toContain(
          'MIGRATION.HINT_CONTRADICTED',
        );
        expect(getMigrationDirs(ctx), 'H4.05: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
