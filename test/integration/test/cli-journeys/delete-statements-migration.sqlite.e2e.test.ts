/**
 * Statements that consent to data loss (SQLite).
 *
 * The SQLite twin of `delete-statements-migration.e2e.test.ts`. SQLite has no checks and no row-level security, so the fixture has a unique field, a secondary index and a foreign key from `Post`, and there is no access to widen.
 *
 * Journey S1 renames `Profile` to `User` and its field `name` to `fullName`, and removes `Legacy`, through `migration plan`: refused without `--delete Legacy`, planned with it, and applied by `migrate`. Journey S2 does the same through `db update`, where `--confirm <database>` no longer consents, and the same statements fail on a second run. Journey S3 adds a required field with no refusal, to an empty table: SQLite's `db update` has no temporary default to fill existing rows, so on a table with rows the runner fails with `MIGRATION.RUNNER_FAILED` rather than asking. Journey S4 drops a model with no snapshot of the database's contract, so the subject is the table's unqualified name.
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
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const USERS = `model User {
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

const LEGACY = `
model Legacy {
  id   Int    @id
  note String
}
`;

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
${LEGACY}`;

const TO_PSL = `// use prisma-8

${USERS}`;

const TO_WITH_LEGACY_PSL = `${TO_PSL}${LEGACY}`;

const TO_REQUIRED_FIELD_PSL = TO_PSL.replace(
  '  handle   String\n',
  '  handle   String\n  nickname String\n',
);

const RENAMES = ['--rename', 'Profile:User', '--rename', 'User.name:User.fullName'] as const;

interface AppliedStatementReport {
  readonly description: string;
}

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
      `INSERT INTO "Profile" (id, name, handle) VALUES (1, 'alice', 'al'), (2, 'bob', 'bo');
       INSERT INTO "Post" (id, "profileId") VALUES (10, 1);
       INSERT INTO "Legacy" (id, note) VALUES (1, 'old')`,
    );
  });
}

function tables(dbPath: string): readonly unknown[] {
  return withDatabase(dbPath, (db) =>
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => row['name']),
  );
}

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

function nextActionsOf(result: Parameters<typeof engineError>[0]): string {
  return JSON.stringify(engineError(result)?.nextActions ?? []);
}

async function expectRenamedWithoutLegacy(ctx: SqliteJourney, label: string): Promise<void> {
  const state = withDatabase(ctx.dbPath, (db) => ({
    rows: db.prepare(`SELECT id, "fullName", handle FROM "User" ORDER BY id`).all(),
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
  expect(state, `${label}: rows and objects under the new names`).toEqual({
    rows: [
      { id: 1, fullName: 'alice', handle: 'al' },
      { id: 2, fullName: 'bob', handle: 'bo' },
    ],
    indexes: [
      expect.stringMatching(/^User_fullName_handle_idx_[0-9a-f]+$/),
      'sqlite_autoindex_User_1',
    ],
    postReferences: [{ table: 'User', from: 'profileId', to: 'id' }],
  });
  const remaining = tables(ctx.dbPath);
  expect(remaining.includes('Profile'), `${label}: the old table is gone`).toBe(false);
  expect(remaining.includes('Legacy'), `${label}: the deleted table is gone`).toBe(false);
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

const STATEMENT_DESCRIPTIONS = [
  'rename model "Profile" to "User"',
  'rename field "User.name" to "User.fullName"',
  'delete model "Legacy"',
];

withTempDir(({ createTempDir }) => {
  describe('Journey S1 (SQLite): rename and delete with migration plan', () => {
    it(
      'refuses the plan until --delete names the dropped model, then migrates it',
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

        const refused = await runMigrationPlan(ctx, ['--from', origin, ...RENAMES, '--json']);
        expect(refused.exitCode, 'S1.05: the plan loses Legacy, so it is refused').toBe(2);
        expect(engineError(refused)?.code, 'S1.05: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionsOf(refused), 'S1.05: names the flag that answers').toContain(
          '--delete Legacy',
        );
        expect(getMigrationDirs(ctx), 'S1.05: nothing written').toHaveLength(1);

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'tidy-users',
          '--from',
          origin,
          ...RENAMES,
          '--delete',
          'Legacy',
          '--json',
        ]);
        expect(plan.exitCode, `S1.06: plan with --delete: ${plan.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
            plan,
          ).appliedStatements.map((entry) => entry.description),
          'S1.06: the renames, then the delete',
        ).toEqual(STATEMENT_DESCRIPTIONS);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `S1.07: migrate: ${apply.stderr}`).toBe(0);
        await expectRenamedWithoutLegacy(ctx, 'S1.08');

        const fresh = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(fresh.exitCode, `S1.09: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'S1.09: plan is empty').toBe(true);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S2 (SQLite): rename and delete with db update', () => {
    it(
      'refuses --confirm, applies with --delete, and refuses the same statements on a second run',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, FROM_PSL, 'S2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S2.02: db update creates the tables: ${create.stderr}`).toBe(0);
        seedRows(ctx.dbPath);
        await emitContract(ctx, TO_PSL, 'S2.03');

        const confirmed = await runDbUpdate(ctx, [
          ...RENAMES,
          '--no-interactive',
          '--confirm',
          'journey.db',
          '--json',
        ]);
        expect(confirmed.exitCode, 'S2.04: --confirm does not consent').toBe(2);
        expect(engineError(confirmed)?.code, 'S2.04: the question is unanswered').toBe(
          'CLI.CONSENT_REQUIRED',
        );
        expect(nextActionsOf(confirmed), 'S2.04: names the flag that answers').toContain(
          '--delete Legacy',
        );

        const update = await runDbUpdate(ctx, [...RENAMES, '--delete', 'Legacy', '--json']);
        expect(update.exitCode, `S2.05: db update with --delete: ${update.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
            update,
          ).appliedStatements.map((entry) => entry.description),
          'S2.05: the renames, then the delete',
        ).toEqual(STATEMENT_DESCRIPTIONS);
        await expectRenamedWithoutLegacy(ctx, 'S2.06');

        const again = await runDbUpdate(ctx, [...RENAMES, '--delete', 'Legacy', '--json']);
        expect(again.exitCode, 'S2.07: the same statements fail on a second run').not.toBe(0);
        expect(engineError(again)?.code, 'S2.07: the first statement no longer resolves').toBe(
          'MIGRATION.STATEMENT_UNRESOLVED',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S3 (SQLite): a required field', () => {
    it(
      'adds a non-nullable field to an empty table without asking',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, TO_PSL, 'S3.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S3.02: db update creates User: ${create.stderr}`).toBe(0);
        await emitContract(ctx, TO_REQUIRED_FIELD_PSL, 'S3.03');

        const update = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(update.exitCode, `S3.04: db update adds the field: ${update.stdout}`).toBe(0);
        const columns = withDatabase(ctx.dbPath, (db) =>
          db
            .prepare(`SELECT name FROM pragma_table_info('User') ORDER BY name`)
            .all()
            .map((row) => row['name']),
        );
        expect(columns, 'S3.04: the field has a column').toContain('nickname');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S4 (SQLite): no snapshot of the database contract', () => {
    it(
      'names the dropped table by its unqualified storage name, and deletes it by that name',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);
        await emitContract(ctx, TO_WITH_LEGACY_PSL, 'S4.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S4.02: db update creates the tables: ${create.stderr}`).toBe(0);
        rmSync(join(ctx.testDir, 'migrations', 'snapshots'), { recursive: true, force: true });
        await emitContract(ctx, TO_PSL, 'S4.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(refused.exitCode, 'S4.04: the drop is refused').toBe(2);
        const refusal = engineError(refused);
        expect(refusal?.code, 'S4.04: the question is unanswered').toBe('CLI.CONSENT_REQUIRED');
        expect(refusal?.meta, 'S4.04: the subject is the table name').toMatchObject({
          unanswered: [{ subject: 'Legacy', verbs: ['delete'] }],
        });
        expect(JSON.stringify(refusal), 'S4.04: the question says why').toContain(
          'named by its storage name because the origin contract is unknown',
        );

        const deleted = await runDbUpdate(ctx, ['--delete', 'Legacy', '--json']);
        expect(deleted.exitCode, `S4.05: --delete Legacy: ${deleted.stderr}`).toBe(0);
        expect(tables(ctx.dbPath).includes('Legacy'), 'S4.05: the table is gone').toBe(false);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
