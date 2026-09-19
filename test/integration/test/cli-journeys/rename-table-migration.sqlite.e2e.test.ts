/**
 * Renaming a table keeps its rows (SQLite).
 *
 * The SQLite twin of `rename-table-migration.e2e.test.ts`, driven through a file database and the SQLite facade config. Journey R3: create `userProfile` with rows, a unique constraint, a foreign key and an index, then drop the `@@map` so the model names `UserProfile`. Planning the change is refused by the case guard, which points at the `renameTable` call; a call naming a table the end contract lacks fails when `migration.ts` builds its operations. A migration created with `migration new` and `...this.renameTable({ table: 'userProfile', to: 'UserProfile' })` renames the table and drops and recreates each index named after the old table; `migrate` keeps the rows; `db verify --schema-only` is clean; a plan with no schema change is empty; and a later migration that removes the unique constraint, the foreign key and the index applies.
 *
 * Journey R4 follows the by-hand path of a project managed with `db update`: the case guard refuses and gives the two-statement rename, the statements are run by hand, and `db update` then drops each index named after the old table before creating it under the new name, keeping the rows.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  authorMigration,
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

const FROM_PSL = `// use prisma-8

model Account {
  id       Int           @id
  profiles UserProfile[]
}

model UserProfile {
  id        Int     @id
  email     String  @unique
  handle    String
  accountId Int
  account   Account @relation(fields: [accountId], references: [id])

  @@index([handle])
  @@map("userProfile")
}
`;

const TO_PSL = `// use prisma-8

model Account {
  id       Int           @id
  profiles UserProfile[]
}

model UserProfile {
  id        Int     @id
  email     String  @unique
  handle    String
  accountId Int
  account   Account @relation(fields: [accountId], references: [id])

  @@index([handle])
}
`;

const DROPPED_PSL = `// use prisma-8

model Account {
  id Int @id
}

model UserProfile {
  id        Int    @id
  email     String
  handle    String
  accountId Int
}
`;

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

withTempDir(({ createTempDir }) => {
  describe('Journey R3 (SQLite): rename a table with migration new and this.renameTable', () => {
    it(
      'guard points at renameTable; a call naming a missing table fails; the call renames the table and recreates its named indexes, keeps the rows, and later changes apply',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `R3.01: emit userProfile: ${emit.stderr}`).toBe(0);
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `R3.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `R3.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        const origin = latestMigrationDirName(ctx);
        withDatabase(ctx.dbPath, (db) => {
          db.exec(
            `INSERT INTO "Account" (id) VALUES (1);
             INSERT INTO "userProfile" (id, email, handle, "accountId")
             VALUES (1, 'alice@example.com', 'alice', 1), (2, 'bob@example.com', 'bob', 1)`,
          );
        });

        writeFileSync(join(ctx.testDir, 'contract.prisma'), TO_PSL, 'utf-8');
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `R3.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);

        const bare = await runMigrationPlan(ctx, ['--name', 'bare', '--from', origin, '--json']);
        expect(bare.exitCode, 'R3.05: bare plan is refused by the guard').not.toBe(0);
        expect(engineError(bare)?.why, 'R3.05: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );
        expect(
          engineError(bare)
            ?.nextActions?.map((action) => action.label)
            .join('\n'),
          'R3.05: guard points at migration new and renameTable',
        ).toContain(
          'create its migration with prisma migration new, and add ...this.renameTable({ table: "userProfile", to: "UserProfile" })',
        );

        const stale = await authorMigration(
          ctx,
          'stale',
          "...this.renameTable({ table: 'userProfile', to: 'Nope' })",
        );
        expect(stale.emit.exitCode, 'R3.06: a call naming a missing table fails').not.toBe(0);
        expect(stale.emit.stderr, 'R3.06: names the unmatched rename').toContain(
          'renameTable "userProfile" to "Nope" does not match the migration\'s contracts: table "Nope" does not exist in the end contract.',
        );
        rmSync(join(ctx.testDir, 'migrations', 'app', stale.dirName), { recursive: true });
        expect(getMigrationDirs(ctx), 'R3.06: only the initial migration remains').toHaveLength(1);

        const rename = await authorMigration(
          ctx,
          'rename-user-profile',
          "...this.renameTable({ table: 'userProfile', to: 'UserProfile' })",
        );
        expect(rename.emit.exitCode, `R3.07: self-emit: ${rename.emit.stderr}`).toBe(0);
        const ops = JSON.parse(
          readFileSync(join(ctx.testDir, 'migrations', 'app', rename.dirName, 'ops.json'), 'utf-8'),
        ) as readonly { readonly label: string }[];
        expect(
          ops.map((op) => op.label),
          'R3.07: the rename, then each index named after the old table dropped and recreated',
        ).toEqual([
          'Rename table userProfile to UserProfile',
          'Drop index userProfile_accountId_idx_cbfb3085 on UserProfile',
          'Drop index userProfile_handle_idx_b5b249e4 on UserProfile',
          'Create index UserProfile_accountId_idx_cbfb3085 on UserProfile',
          'Create index UserProfile_handle_idx_b5b249e4 on UserProfile',
        ]);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R3.08: migrate: ${apply.stderr}`).toBe(0);
        const state = withDatabase(ctx.dbPath, (db) => ({
          rows: db.prepare(`SELECT id, email FROM "UserProfile" ORDER BY id`).all(),
          objects: db
            .prepare(
              `SELECT type, name FROM sqlite_master WHERE tbl_name = 'UserProfile' ORDER BY type, name`,
            )
            .all()
            .map((row) => `${row['type']} ${row['name']}`),
          tables: db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%serProfile'`,
            )
            .all()
            .map((row) => row['name']),
        }));
        expect(state.rows, 'R3.09: rows present under the new name').toEqual([
          { id: 1, email: 'alice@example.com' },
          { id: 2, email: 'bob@example.com' },
        ]);
        expect(state.tables, 'R3.09: old name is gone').toEqual(['UserProfile']);
        expect(state.objects, 'R3.09: every index follows the new name').toEqual([
          'index UserProfile_accountId_idx_cbfb3085',
          'index UserProfile_handle_idx_b5b249e4',
          'index sqlite_autoindex_UserProfile_1',
          'table UserProfile',
        ]);

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R3.10: db verify --schema-only: ${verify.stderr}`).toBe(0);

        const fresh = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(fresh.exitCode, `R3.11: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'R3.11: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'R3.11: nothing written').toHaveLength(2);

        writeFileSync(join(ctx.testDir, 'contract.prisma'), DROPPED_PSL, 'utf-8');
        const emitDropped = await runContractEmit(ctx);
        expect(emitDropped.exitCode, `R3.12: emit without objects: ${emitDropped.stderr}`).toBe(0);
        const dropPlan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'drop-objects',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(dropPlan.exitCode, `R3.12: plan the removal: ${dropPlan.stderr}`).toBe(0);
        const applyDrop = await runMigrate(ctx);
        expect(applyDrop.exitCode, `R3.13: migrate the removal: ${applyDrop.stderr}`).toBe(0);
        const remaining = withDatabase(ctx.dbPath, (db) => ({
          rows: db.prepare(`SELECT id, email FROM "UserProfile" ORDER BY id`).all(),
          objects: db
            .prepare(
              `SELECT type, name FROM sqlite_master WHERE tbl_name = 'UserProfile' ORDER BY type, name`,
            )
            .all()
            .map((row) => `${row['type']} ${row['name']}`),
        }));
        expect(remaining, 'R3.13: unique, foreign key and indexes removed, rows kept').toEqual({
          rows: [
            { id: 1, email: 'alice@example.com' },
            { id: 2, email: 'bob@example.com' },
          ],
          objects: ['table UserProfile'],
        });
        const verifyDropped = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verifyDropped.exitCode,
          `R3.14: db verify --schema-only after the removal: ${verifyDropped.stderr}`,
        ).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey R4 (SQLite): rename a table by hand in a project managed with db update', () => {
    it(
      'the guard gives the two-statement rename; after running it, db update recreates the indexes and verify is clean',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `R4.01: emit userProfile: ${emit.stderr}`).toBe(0);
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `R4.02: db update creates userProfile: ${create.stderr}`).toBe(0);
        withDatabase(ctx.dbPath, (db) => {
          db.exec(
            `INSERT INTO "Account" (id) VALUES (1);
             INSERT INTO "userProfile" (id, email, handle, "accountId")
             VALUES (1, 'alice@example.com', 'alice', 1), (2, 'bob@example.com', 'bob', 1)`,
          );
        });

        writeFileSync(join(ctx.testDir, 'contract.prisma'), TO_PSL, 'utf-8');
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `R4.03: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);

        const refused = await runDbUpdate(ctx, ['--json']);
        expect(refused.exitCode, 'R4.04: db update is refused by the guard').not.toBe(0);
        const refusal = engineError(refused);
        expect(refusal?.why, 'R4.04: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );
        expect(
          refusal?.nextActions?.map((action) => action.label).join('\n'),
          'R4.04: guard gives the SQLite by-hand statements',
        ).toContain(
          'rename it by hand with ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"; ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile", then run db update again.',
        );

        withDatabase(ctx.dbPath, (db) => {
          db.exec('ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"');
          db.exec('ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"');
        });

        const update = await runDbUpdate(ctx, ['--json', '--confirm', 'journey.db']);
        expect(update.exitCode, `R4.05: db update after the rename: ${update.stdout}`).toBe(0);
        const state = withDatabase(ctx.dbPath, (db) => ({
          rows: db.prepare(`SELECT id, email FROM "UserProfile" ORDER BY id`).all(),
          objects: db
            .prepare(
              `SELECT type, name FROM sqlite_master WHERE tbl_name = 'UserProfile' ORDER BY type, name`,
            )
            .all()
            .map((row) => `${row['type']} ${row['name']}`),
        }));
        expect(state, 'R4.06: rows kept, indexes under the new name').toEqual({
          rows: [
            { id: 1, email: 'alice@example.com' },
            { id: 2, email: 'bob@example.com' },
          ],
          objects: [
            'index UserProfile_accountId_idx_cbfb3085',
            'index UserProfile_handle_idx_b5b249e4',
            'index sqlite_autoindex_UserProfile_1',
            'table UserProfile',
          ],
        });

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R4.07: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
