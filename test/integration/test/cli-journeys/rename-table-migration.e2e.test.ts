/**
 * Renaming a table keeps its rows (Postgres).
 *
 * A model whose table name changes plans as `dropTable` plus `createTable`. A user who wants the rows makes the rename its own schema change, creates its migration with `migration new`, and writes `...this.renameTable({ table, to })`, which renames the table and each constraint and index named after the old table.
 *
 * Journey R1 creates `userProfile` with rows, a unique constraint, a foreign key, an index, row-level security and a policy, then drops the model's `@@map` so it names `UserProfile`. Planning the change is refused by the case-change guard, which points at the `renameTable` call; a call naming a table the end contract lacks fails when `migration.ts` builds its operations. After `migrate` the rows, the policy and RLS are kept, every constraint and index carries the new table name, `db verify --schema-only` is clean, a plan with no schema change is empty, and a later migration that removes the unique constraint, the foreign key and the index applies.
 *
 * Journey R5 changes a table's name and its foreign key's target in one schema change. A hand-written migration that only renames fails at `migrate`, which verifies the database against the migration's end contract. Made as two changes, a rename-only migration and then a planned foreign key change, it keeps the rows and verifies clean.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  authorMigration,
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  sql,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const FOREIGN_KEY_FROM_PSL = `// use prisma-8

model Account {
  id       Int           @id
  profiles UserProfile[]
}

model Member {
  id Int @id
}

model UserProfile {
  id        Int     @id
  accountId Int
  account   Account @relation(fields: [accountId], references: [id])

  @@map("userProfile")
}
`;

const FOREIGN_KEY_RENAMED_PSL = `// use prisma-8

model Account {
  id       Int           @id
  profiles UserProfile[]
}

model Member {
  id Int @id
}

model UserProfile {
  id        Int     @id
  accountId Int
  account   Account @relation(fields: [accountId], references: [id])
}
`;

const FOREIGN_KEY_TO_PSL = `// use prisma-8

model Account {
  id Int @id
}

model Member {
  id       Int           @id
  profiles UserProfile[]
}

model UserProfile {
  id        Int    @id
  accountId Int
  member    Member @relation(fields: [accountId], references: [id], map: "profile_member_fk")
}
`;

const RENAME_CALL = "...this.renameTable({ table: 'userProfile', to: 'UserProfile' })";

const RENAME_LABELS = [
  'Rename table "userProfile" to "UserProfile"',
  'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
  'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
  'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
  'Rename index "userProfile_accountId_idx_cbfb3085" to "UserProfile_accountId_idx_cbfb3085" on "UserProfile"',
  'Rename index "userProfile_handle_idx_b5b249e4" to "UserProfile_handle_idx_b5b249e4" on "UserProfile"',
];

async function seedTableWithObjects(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<string> {
  await sql(connectionString, 'CREATE ROLE app_user');
  swapPslContract(ctx, 'contract-rename-table-objects-from');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}.01: emit userProfile: ${emit.stderr}`).toBe(0);
  const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
  const applyInitial = await runMigrate(ctx);
  expect(applyInitial.exitCode, `${label}.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
  await sql(
    connectionString,
    `INSERT INTO "public"."Account" (id) VALUES (1);
     INSERT INTO "public"."userProfile" (id, email, handle, tenant_id, "accountId")
     VALUES (1, 'alice@example.com', 'alice', 1, 1), (2, 'bob@example.com', 'bob', 1, 1)`,
  );
  swapPslContract(ctx, 'contract-rename-table-objects-to');
  const emitRenamed = await runContractEmit(ctx);
  expect(emitRenamed.exitCode, `${label}.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);
  return latestMigrationDirName(ctx);
}

async function expectRenameApplied(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(
    connectionString,
    `SELECT id, email FROM "public"."UserProfile" ORDER BY id`,
  );
  expect(rows.rows, `${label}: rows present under the new name`).toEqual([
    { id: 1, email: 'alice@example.com' },
    { id: 2, email: 'bob@example.com' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."userProfile"') AS old,
       (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS indexes,
       (SELECT array_agg(policyname::text) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS policies,
       (SELECT relrowsecurity FROM pg_class
         WHERE oid = '"public"."UserProfile"'::regclass) AS rls`,
  );
  expect(live.rows[0], `${label}: old name gone, objects renamed, policy and RLS kept`).toEqual({
    old: null,
    constraints: ['UserProfile_accountId_fkey', 'UserProfile_email_key', 'UserProfile_pkey'],
    indexes: [
      'UserProfile_accountId_idx_cbfb3085',
      'UserProfile_email_key',
      'UserProfile_handle_idx_b5b249e4',
      'UserProfile_pkey',
    ],
    policies: ['tenant_read_f8d5e783'],
    rls: true,
  });

  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

async function expectLaterChangesApply(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const migrationCount = getMigrationDirs(ctx).length;
  const fresh = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx), '--json']);
  expect(fresh.exitCode, `${label}.01: plan with no schema change: ${fresh.stderr}`).toBe(0);
  expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}.01: plan is empty`).toBe(true);
  expect(getMigrationDirs(ctx), `${label}.01: nothing written`).toHaveLength(migrationCount);

  swapPslContract(ctx, 'contract-rename-table-objects-dropped');
  const emitDropped = await runContractEmit(ctx);
  expect(emitDropped.exitCode, `${label}.02: emit without objects: ${emitDropped.stderr}`).toBe(0);
  const dropPlan = await planMigrationAndSelfEmit(ctx, [
    '--name',
    'drop-objects',
    '--from',
    latestMigrationDirName(ctx),
    '--json',
  ]);
  expect(dropPlan.exitCode, `${label}.02: plan the removal: ${dropPlan.stderr}`).toBe(0);
  const applyDrop = await runMigrate(ctx);
  expect(applyDrop.exitCode, `${label}.03: migrate the removal: ${applyDrop.stderr}`).toBe(0);
  const remaining = await sql(
    connectionString,
    `SELECT
       (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS indexes`,
  );
  expect(remaining.rows[0], `${label}.03: unique, foreign key and indexes removed`).toEqual({
    constraints: ['UserProfile_pkey'],
    indexes: ['UserProfile_pkey'],
  });
  const verifyDropped = await runDbVerify(ctx, ['--schema-only']);
  expect(
    verifyDropped.exitCode,
    `${label}.04: db verify --schema-only after the removal: ${verifyDropped.stderr}`,
  ).toBe(0);
}

function operationsOf(ctx: JourneyContext, dirName: string) {
  return JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations', 'app', dirName, 'ops.json'), 'utf-8'),
  ) as readonly { readonly label: string; readonly operationClass: string }[];
}

withTempDir(({ createTempDir }) => {
  describe('Journey R1: rename a table with migration new and this.renameTable', () => {
    const db = useDevDatabase();

    it(
      'guard points at renameTable; a call naming a missing table fails; the call renames the table and its named objects, keeps rows and policies, and later changes apply',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const origin = await seedTableWithObjects(ctx, db.connectionString, 'R1');

        const bare = await runMigrationPlan(ctx, ['--name', 'bare', '--from', origin, '--json']);
        expect(bare.exitCode, 'R1.05: bare plan is refused').not.toBe(0);
        const bareError = engineError(bare);
        expect(bareError?.code, 'R1.05: guard code').toBe('MIGRATION.PLANNING_FAILED');
        expect(bareError?.why, 'R1.05: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );
        expect(
          bareError?.nextActions?.map((action) => action.label).join('\n'),
          'R1.05: guard points at migration new and renameTable',
        ).toContain(
          'create its migration with prisma migration new, and add ...this.renameTable({ table: "userProfile", to: "UserProfile" })',
        );
        expect(getMigrationDirs(ctx), 'R1.05: nothing written').toHaveLength(1);

        const stale = await authorMigration(
          ctx,
          'stale',
          "...this.renameTable({ table: 'userProfile', to: 'Nope' })",
        );
        expect(stale.emit.exitCode, 'R1.06: a call naming a missing table fails').not.toBe(0);
        expect(stale.emit.stderr, 'R1.06: names the unmatched rename').toContain(
          'renameTable "userProfile" to "Nope" does not match the migration\'s contracts: table "public.Nope" does not exist in the end contract.',
        );
        rmSync(join(ctx.testDir, 'migrations', 'app', stale.dirName), { recursive: true });

        const rename = await authorMigration(ctx, 'rename-user-profile', RENAME_CALL);
        expect(rename.emit.exitCode, `R1.07: self-emit: ${rename.emit.stderr}`).toBe(0);
        const ops = operationsOf(ctx, rename.dirName);
        expect(
          ops.map((op) => op.label),
          'R1.07: the rename, then a rename of each object named after the old table',
        ).toEqual(RENAME_LABELS);
        expect(
          ops.every((op) => op.operationClass === 'widening'),
          'R1.07: every operation is a widening rename',
        ).toBe(true);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectRenameApplied(ctx, db.connectionString, 'R1.09');
        await expectLaterChangesApply(ctx, db.connectionString, 'R1.10');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey R5: rename a table, then point its foreign key at another table', () => {
    const db = useDevDatabase();

    it(
      'a rename migration that omits the foreign key change fails at migrate; a rename-only change, then a planned foreign key change, keeps the rows and verifies clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), FOREIGN_KEY_FROM_PSL);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `R5.01: emit userProfile: ${emit.stderr}`).toBe(0);
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `R5.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `R5.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        await sql(
          db.connectionString,
          `INSERT INTO "public"."Account" (id) VALUES (1);
         INSERT INTO "public"."Member" (id) VALUES (1);
         INSERT INTO "public"."userProfile" (id, "accountId") VALUES (1, 1)`,
        );

        writeFileSync(join(ctx.testDir, 'contract.prisma'), FOREIGN_KEY_TO_PSL);
        const emitBoth = await runContractEmit(ctx);
        expect(emitBoth.exitCode, `R5.04: emit both changes: ${emitBoth.stderr}`).toBe(0);
        const incomplete = await authorMigration(ctx, 'rename-and-retarget', RENAME_CALL);
        expect(incomplete.emit.exitCode, `R5.05: self-emit: ${incomplete.emit.stderr}`).toBe(0);
        const refused = await runMigrate(ctx, ['--json']);
        expect(refused.exitCode, 'R5.06: migrate refuses the incomplete migration').not.toBe(0);
        expect(
          engineError(refused),
          'R5.06: the database does not match the end contract',
        ).toMatchObject({
          code: 'MIGRATION.RUNNER_FAILED',
          summary: expect.stringContaining('Database schema does not satisfy contract'),
        });
        const untouched = await sql(
          db.connectionString,
          `SELECT to_regclass('"public"."userProfile"')::text AS old, to_regclass('"public"."UserProfile"')::text AS new`,
        );
        expect(untouched.rows[0], 'R5.06: the failed migration left the table as it was').toEqual({
          old: '"userProfile"',
          new: null,
        });
        rmSync(join(ctx.testDir, 'migrations', 'app', incomplete.dirName), { recursive: true });
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'app', incomplete.dirName)),
          'R5.06: the incomplete migration is removed',
        ).toBe(false);

        writeFileSync(join(ctx.testDir, 'contract.prisma'), FOREIGN_KEY_RENAMED_PSL);
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `R5.07: emit the rename alone: ${emitRenamed.stderr}`).toBe(0);
        const rename = await authorMigration(ctx, 'rename-user-profile', RENAME_CALL);
        expect(rename.emit.exitCode, `R5.07: self-emit: ${rename.emit.stderr}`).toBe(0);
        expect(
          operationsOf(ctx, rename.dirName).map((op) => op.label),
          'R5.07: the rename',
        ).toEqual([
          'Rename table "userProfile" to "UserProfile"',
          'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
          'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
          'Rename index "userProfile_accountId_idx_cbfb3085" to "UserProfile_accountId_idx_cbfb3085" on "UserProfile"',
        ]);
        const applyRename = await runMigrate(ctx);
        expect(applyRename.exitCode, `R5.08: migrate the rename: ${applyRename.stderr}`).toBe(0);

        writeFileSync(join(ctx.testDir, 'contract.prisma'), FOREIGN_KEY_TO_PSL);
        const emitRetarget = await runContractEmit(ctx);
        expect(
          emitRetarget.exitCode,
          `R5.09: emit the foreign key change: ${emitRetarget.stderr}`,
        ).toBe(0);
        const retarget = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'retarget-foreign-key',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(retarget.exitCode, `R5.09: plan the foreign key change: ${retarget.stderr}`).toBe(0);
        const applyRetarget = await runMigrate(ctx);
        expect(applyRetarget.exitCode, `R5.10: migrate: ${applyRetarget.stderr}`).toBe(0);
        const live = await sql(
          db.connectionString,
          `SELECT
           (SELECT array_agg(id) FROM "public"."UserProfile") AS ids,
           (SELECT array_agg(conname::text || '->' || confrelid::regclass::text ORDER BY conname)
              FROM pg_constraint
             WHERE conrelid = '"public"."UserProfile"'::regclass AND contype = 'f') AS foreign_keys`,
        );
        expect(live.rows[0], 'R5.11: rows kept, one foreign key to Member').toEqual({
          ids: [1],
          foreign_keys: ['profile_member_fk->"Member"'],
        });
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R5.12: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
