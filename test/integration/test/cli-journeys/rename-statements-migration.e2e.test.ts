/**
 * Rename statements on the command line (Postgres).
 *
 * `--rename <old>:<new>` tells `migration plan` and `db update` that a model or a field was renamed, so the planner renames the table or column, and the constraints and indexes named after it, instead of dropping and creating them.
 *
 * Journey S1 creates `Profile` with rows, a unique field, a secondary index, a check, row-level security with a policy, and a `Post` model with a foreign key to it. The destination renames the model to `User` and its field `name` to `fullName`. `migration plan --rename Profile:User --rename User.name:User.fullName` plans only widening renames, lists both statements as applied, and re-running the written `migration.ts` reproduces `ops.json` and `migration.json` byte for byte. After `migrate`, the rows, the constraints, the indexes, the check and the policy are under the new names, a further plan is empty, and `db verify --schema-only` is clean.
 *
 * Journey S2 does the same through `db update`, with no consent asked; running the same statements again fails because the database's contract no longer has the old names.
 *
 * Journey S3 covers the errors: a statement whose names do not resolve, a field statement that names the field's model by its old name, and a `db update --db <url>` whose database has no contract snapshot to resolve against.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
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
  setupJourney,
  sql,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

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

async function createAppUserRole(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    'DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );
}

async function seedRows(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    `INSERT INTO "public"."Profile" (id, name, handle, tenant_id)
     VALUES (1, 'alice', 'al', 1), (2, 'bob', 'bo', 1);
     INSERT INTO "public"."Post" (id, "profileId") VALUES (10, 1)`,
  );
}

async function emitContract(
  ctx: JourneyContext,
  variant: 'contract-rename-statements-from' | 'contract-rename-statements-to',
  label: string,
): Promise<void> {
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit ${variant}: ${emit.stderr}`).toBe(0);
}

/** The plan both commands make for the two statements: renames only, each companion after its rename. */
const RENAME_OPERATIONS: readonly Omit<PlannedOperation, 'id'>[] = [
  { operationClass: 'widening', label: 'Rename table "Profile" to "User"' },
  {
    operationClass: 'widening',
    label: 'Rename primary key "Profile_pkey" to "User_pkey" on "User"',
  },
  { operationClass: 'widening', label: 'Rename column "User"."name" to "fullName"' },
  {
    operationClass: 'widening',
    label: 'Rename unique constraint "Profile_name_key" to "User_fullName_key" on "User"',
  },
  {
    operationClass: 'widening',
    label:
      'Rename index "Profile_name_handle_idx_f7a67607" to "User_fullName_handle_idx_46490beb" on "User"',
  },
];

function expectOnlyRenames(operations: readonly PlannedOperation[], label: string): void {
  expect(
    operations.map(({ label: text, operationClass }) => ({ label: text, operationClass })),
    `${label}: only widening renames, no table or column dropped or created`,
  ).toEqual(RENAME_OPERATIONS);
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
  ).toEqual([2, 3]);
  expect(
    applied.flatMap((entry) => entry.operationIndexes.map((index) => operations[index]?.id)),
    `${label}: the statements' positions name the plan's operations, in order`,
  ).toEqual(operations.map((operation) => operation.id));
}

async function expectRenamedState(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(
    connectionString,
    `SELECT id, "fullName", handle FROM "public"."User" ORDER BY id`,
  );
  expect(rows.rows, `${label}: rows present under the new names`).toEqual([
    { id: 1, fullName: 'alice', handle: 'al' },
    { id: 2, fullName: 'bob', handle: 'bo' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."Profile"') AS old,
       (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
         WHERE attrelid = '"public"."User"'::regclass AND attnum > 0 AND NOT attisdropped) AS columns,
       (SELECT array_agg(conname::text || ':' || contype::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."User"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'User') AS indexes,
       (SELECT array_agg(policyname::text) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'User') AS policies,
       (SELECT relrowsecurity FROM pg_class WHERE oid = '"public"."User"'::regclass) AS rls,
       (SELECT array_agg(confrelid::regclass::text) FROM pg_constraint
         WHERE conrelid = '"public"."Post"'::regclass AND contype = 'f') AS post_references`,
  );
  expect(live.rows[0], `${label}: old table gone, every object under the new names`).toEqual({
    old: null,
    columns: ['fullName', 'handle', 'id', 'tenant_id'],
    constraints: [
      'User_fullName_key:u',
      'User_pkey:p',
      expect.stringMatching(/^handle_present(_[0-9a-f]+)?:c$/),
    ],
    indexes: ['User_fullName_handle_idx_46490beb', 'User_fullName_key', 'User_pkey'],
    policies: [expect.stringMatching(/^tenant_read_[0-9a-f]+$/)],
    rls: true,
    post_references: ['"User"'],
  });
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
  describe('Journey S1: rename a model and a field with migration plan --rename', () => {
    const db = useDevDatabase();

    it(
      'plans widening renames in place of drops, re-emits byte for byte, and keeps rows and objects under the new names',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, 'contract-rename-statements-from', 'S1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `S1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `S1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, 'contract-rename-statements-to', 'S1.04');

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
          "...this.renameTable({ schema: 'public', table: 'Profile', to: 'User' })",
        );
        expect(written.source, 'S1.06: migration.ts holds the column rename').toContain(
          "...this.renameColumn({ schema: 'public', table: 'User', column: 'name', to: 'fullName' })",
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
        await expectRenamedState(ctx, db.connectionString, 'S1.09');

        const migrationCount = getMigrationDirs(ctx).length;
        const fresh = await runMigrationPlan(ctx, ['--from', renameDir, '--json']);
        expect(fresh.exitCode, `S1.10: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'S1.10: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'S1.10: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S2: rename a model and a field with db update --rename', () => {
    const db = useDevDatabase();

    it(
      'applies the renames without consent, and refuses the same statements on a second run',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, 'contract-rename-statements-from', 'S2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S2.02: db update creates Profile: ${create.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        await emitContract(ctx, 'contract-rename-statements-to', 'S2.03');

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
        await expectRenamedState(ctx, db.connectionString, 'S2.05');

        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `S2.06: db update --dry-run: ${dryRun.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan
            .operations,
          'S2.06: db update without statements plans nothing against the live database',
        ).toEqual([]);

        const markerHash = updated.plan.destination.storageHash;
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'snapshots', markerHash, 'contract.json')),
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

  describe('Journey S3: statements that cannot be used', () => {
    const db = useDevDatabase();

    it(
      'refuses unresolved names, a field named through its old model, and a db update with no snapshot to resolve against',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, 'contract-rename-statements-from', 'S3.01');
        const create = await runDbUpdate(ctx, ['--db', db.connectionString, '--json']);
        expect(create.exitCode, `S3.02: db update --db creates Profile: ${create.stderr}`).toBe(0);
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'snapshots')),
          'S3.02: db update --db without --advance-ref stored no snapshot',
        ).toBe(false);
        await emitContract(ctx, 'contract-rename-statements-to', 'S3.03');

        const noOrigin = await runDbUpdate(ctx, [
          '--db',
          db.connectionString,
          '--rename',
          'Profile:User',
          '--json',
        ]);
        expect(noOrigin.exitCode, 'S3.04: db update without a snapshot is refused').not.toBe(0);
        const originError = engineError(noOrigin);
        expect(originError?.code, 'S3.04: the origin contract is unknown').toBe(
          'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
        );
        expect(originError?.why, 'S3.04: names the snapshot directory').toContain(
          join('migrations', 'snapshots'),
        );
        expect(
          originError?.nextActions?.map((action) => action.label).join('\n'),
          'S3.04: advises --advance-ref on the earlier run',
        ).toContain('--advance-ref <name>');

        rmSync(join(ctx.testDir, 'migrations'), { recursive: true, force: true });
        await emitContract(ctx, 'contract-rename-statements-from', 'S3.05');
        const initial = await runMigrationPlan(ctx, ['--name', 'initial', '--from', '@empty']);
        expect(initial.exitCode, `S3.05: plan initial: ${initial.stderr}`).toBe(0);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, 'contract-rename-statements-to', 'S3.06');

        const unresolved = await runMigrationPlan(ctx, [
          '--from',
          origin,
          '--rename',
          'Profile:Nope',
          '--json',
        ]);
        expect(engineError(unresolved)?.code, 'S3.07: an unknown new name is unresolved').toBe(
          'MIGRATION.STATEMENT_UNRESOLVED',
        );
        expect(getMigrationDirs(ctx), 'S3.07: nothing written').toHaveLength(1);

        const wrongModel = await runMigrationPlan(ctx, [
          '--from',
          origin,
          '--rename',
          'Profile:User',
          '--rename',
          'Profile.name:User.fullName',
          '--json',
        ]);
        const invalid = engineError(wrongModel);
        expect(invalid?.code, 'S3.08: a field named through its old model is invalid').toBe(
          'MIGRATION.STATEMENT_INVALID',
        );
        expect(invalid?.why, 'S3.08: the message gives the corrected statement').toContain(
          '--rename User.name:User.fullName',
        );
        expect(getMigrationDirs(ctx), 'S3.08: nothing written').toHaveLength(1);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
