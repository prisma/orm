/**
 * Rename statements on the command line (SQLite).
 *
 * The SQLite twin of `rename-statements-migration.e2e.test.ts`, driven through a file database and the SQLite facade config. SQLite has no checks and no row-level security, so the fixture has a unique field, a secondary index and a foreign key from `Post`. SQLite cannot rename an index, so the index on the renamed column is dropped and created under the destination's name.
 *
 * Journey S1 plans the model and field renames with `migration plan --rename Profile:User --rename User.name:User.fullName`, re-emits `migration.ts` byte for byte, migrates, and checks the rows, the indexes and the foreign key under the new names. Journey S2 applies the same statements with `db update` without consent and refuses them on a second run.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const FROM_PSL = `// use prisma-8

model Profile {
  id     Int    @id
  name   String @unique
  handle String
  posts  Post[]

  @@index([name, handle])
}

model Post {
  id        Int     @id
  profileId Int
  profile   Profile @relation(fields: [profileId], references: [id])
}
`;

const TO_PSL = `// use prisma-8

model User {
  id       Int    @id
  fullName String @unique
  handle   String
  posts    Post[]

  @@index([fullName, handle])
}

model Post {
  id        Int  @id
  profileId Int
  profile   User @relation(fields: [profileId], references: [id])
}
`;

const RENAMES = ['--rename', 'Profile:User', '--rename', 'User.name:User.fullName'] as const;

interface PlannedOperation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: string;
}

interface AppliedStatementReport {
  readonly description: string;
  readonly operationIndexes: readonly number[];
}

function setupSqliteJourney(createTempDir: () => string): JourneyContext & { dbPath: string } {
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
      `INSERT INTO "Profile" (id, name, handle) VALUES (1, 'alice', 'al'), (2, 'bob', 'bo');
       INSERT INTO "Post" (id, "profileId") VALUES (10, 1)`,
    );
  });
}

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

function expectOnlyRenames(operations: readonly PlannedOperation[], label: string): void {
  const labels = operations.map((operation) => operation.label);
  expect(labels.slice(0, 2), `${label}: the table rename, then the column rename`).toEqual([
    'Rename table Profile to User',
    'Rename column name on User to fullName',
  ]);
  expect(
    labels.slice(2),
    `${label}: the index on the column is replaced under its new name`,
  ).toEqual([
    expect.stringMatching(/^Drop index Profile_name_handle_idx_[0-9a-f]+ on User$/),
    expect.stringMatching(/^Create index User_fullName_handle_idx_[0-9a-f]+ on User$/),
  ]);
  expect(
    operations.every(
      (operation) =>
        operation.operationClass === 'widening' || /^Create index/.test(operation.label),
    ),
    `${label}: the renames and the index drop are widening`,
  ).toBe(true);
}

function expectAppliedStatements(
  applied: readonly AppliedStatementReport[],
  operations: readonly PlannedOperation[],
  label: string,
): void {
  expect(
    applied.map((entry) => entry.description),
    `${label}: both statements applied, in order`,
  ).toEqual(['rename model "Profile" to "User"', 'rename field "User.name" to "User.fullName"']);
  expect(
    applied.map((entry) => entry.operationIndexes.length),
    `${label}: the model rename and the field rename with their companions`,
  ).toEqual([1, 3]);
  expect(
    applied.flatMap((entry) => entry.operationIndexes.map((index) => operations[index]?.id)),
    `${label}: the statements' positions name the plan's operations, in order`,
  ).toEqual(operations.map((operation) => operation.id));
}

async function expectRenamedState(
  ctx: JourneyContext & { dbPath: string },
  label: string,
): Promise<void> {
  const state = withDatabase(ctx.dbPath, (db) => ({
    rows: db.prepare(`SELECT id, "fullName", handle FROM "User" ORDER BY id`).all(),
    columns: db
      .prepare(`SELECT name FROM pragma_table_info('User') ORDER BY name`)
      .all()
      .map((row) => row['name']),
    tables: db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => row['name']),
    indexes: db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'User' ORDER BY name`,
      )
      .all()
      .map((row) => row['name']),
    postReferences: db
      .prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list('Post')`)
      .all(),
  }));
  expect(state.rows, `${label}: rows present under the new names`).toEqual([
    { id: 1, fullName: 'alice', handle: 'al' },
    { id: 2, fullName: 'bob', handle: 'bo' },
  ]);
  expect(state.columns, `${label}: the column has its new name`).toEqual([
    'fullName',
    'handle',
    'id',
  ]);
  expect(state.tables.includes('Profile'), `${label}: the old table is gone`).toBe(false);
  expect(state.indexes, `${label}: the index on the column has its destination name`).toEqual([
    expect.stringMatching(/^User_fullName_handle_idx_[0-9a-f]+$/),
    'sqlite_autoindex_User_1',
  ]);
  expect(state.postReferences, `${label}: the foreign key from Post follows the table`).toEqual([
    { table: 'User', from: 'profileId', to: 'id' },
  ]);
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

withTempDir(({ createTempDir }) => {
  describe('Journey S1 (SQLite): rename a model and a field with migration plan --rename', () => {
    it(
      'plans the renames in place of drops, re-emits byte for byte, and keeps the rows under the new names',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, FROM_PSL, 'S1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `S1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `S1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        seedRows(ctx.dbPath);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, TO_PSL, 'S1.04');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'tidy-users',
          '--from',
          origin,
          ...RENAMES,
          '--json',
        ]);
        expect(plan.exitCode, `S1.05: plan with statements: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<{
          ok: boolean;
          operations: readonly PlannedOperation[];
          appliedStatements: readonly AppliedStatementReport[];
        }>(plan);
        expect(planned.ok, 'S1.05: plan succeeds').toBe(true);
        expectOnlyRenames(planned.operations, 'S1.05');
        expectAppliedStatements(planned.appliedStatements, planned.operations, 'S1.05');

        const renameDir = latestMigrationDirName(ctx);
        const written = packageFiles(ctx, renameDir);
        expect(written.source, 'S1.06: migration.ts holds the facade calls').toContain(
          "...this.renameTable({ table: 'Profile', to: 'User' })",
        );
        expect(written.source, 'S1.06: migration.ts holds the column rename').toContain(
          "...this.renameColumn({ table: 'User', column: 'name', to: 'fullName' })",
        );
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${renameDir}`]);
        expect(reEmit.exitCode, `S1.07: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        const reEmitted = packageFiles(ctx, renameDir);
        expect(reEmitted.ops, 'S1.07: ops.json is byte-identical after re-emit').toBe(written.ops);
        expect(reEmitted.migration, 'S1.07: migration.json is byte-identical after re-emit').toBe(
          written.migration,
        );

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `S1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectRenamedState(ctx, 'S1.09');

        const migrationCount = getMigrationDirs(ctx).length;
        const fresh = await runMigrationPlan(ctx, ['--from', renameDir, '--json']);
        expect(fresh.exitCode, `S1.10: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'S1.10: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'S1.10: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S2 (SQLite): rename a model and a field with db update --rename', () => {
    it(
      'applies the renames without consent, and refuses the same statements on a second run',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, FROM_PSL, 'S2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S2.02: db update creates Profile: ${create.stderr}`).toBe(0);
        seedRows(ctx.dbPath);
        await emitContract(ctx, TO_PSL, 'S2.03');

        const update = await runDbUpdate(ctx, [...RENAMES, '--json']);
        expect(update.exitCode, `S2.04: db update with statements: ${update.stderr}`).toBe(0);
        const updated = parseJsonOutput<{
          ok: boolean;
          plan: { operations: readonly PlannedOperation[]; destination: { storageHash: string } };
          appliedStatements: readonly AppliedStatementReport[];
        }>(update);
        expect(updated.ok, 'S2.04: db update succeeds without consent').toBe(true);
        expectOnlyRenames(updated.plan.operations, 'S2.04');
        expectAppliedStatements(updated.appliedStatements, updated.plan.operations, 'S2.04');
        await expectRenamedState(ctx, 'S2.05');

        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `S2.06: db update --dry-run: ${dryRun.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan
            .operations,
          'S2.06: db update without statements plans nothing against the live database',
        ).toEqual([]);

        expect(
          existsSync(
            join(
              ctx.testDir,
              'migrations',
              'snapshots',
              updated.plan.destination.storageHash,
              'contract.json',
            ),
          ),
          'S2.07: db update stored the snapshot of the contract it applied',
        ).toBe(true);
        const again = await runDbUpdate(ctx, [...RENAMES, '--json']);
        expect(again.exitCode, 'S2.07: the same statements fail on a second run').not.toBe(0);
        const refusal = engineError(again);
        expect(refusal?.code, 'S2.07: the old name no longer resolves').toBe(
          'MIGRATION.STATEMENT_UNRESOLVED',
        );
        expect(refusal?.why, 'S2.07: says the rename has already happened').toContain(
          'The origin contract already has "User" and has no "Profile", so this rename has already happened.',
        );
        expect(
          refusal?.nextActions?.map((action) => action.label),
          'S2.07: says to leave out the statement',
        ).toEqual(['Leave out --rename Profile:User.']);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
