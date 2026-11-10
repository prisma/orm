/**
 * A model statement that moves a model to another namespace (Postgres).
 *
 * `--rename public.Invoice:billing.Invoice` tells `migration plan` and `db update` that the model `Invoice` moved from namespace `public` to namespace `billing`. The planner creates schema `billing`, then moves the table there with `ALTER TABLE … SET SCHEMA`, instead of dropping the table and creating it again. The foreign key from `Payment` keeps pointing at the moved table, so nothing is planned for it.
 *
 * Journey M1 plans the move with `migration plan`, re-runs the written `migration.ts`, which reproduces `ops.json` and `migration.json` byte for byte, applies it with `migrate`, and plans nothing more. Journey M2 applies the move with `db update`, which asks no data-loss question.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
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

const MOVE = ['--rename', 'public.Invoice:billing.Invoice'] as const;

interface PlannedOperation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: string;
}

interface AppliedStatementReport {
  readonly description: string;
  readonly operationIndexes: readonly number[];
}

const MOVE_OPERATIONS: readonly Omit<PlannedOperation, 'id'>[] = [
  { operationClass: 'additive', label: 'Create schema "billing"' },
  { operationClass: 'widening', label: 'Move table "Invoice" to schema "billing"' },
];

async function emitContract(
  ctx: JourneyContext,
  variant: 'contract-move-statements-from' | 'contract-move-statements-to',
  label: string,
): Promise<void> {
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit ${variant}: ${emit.stderr}`).toBe(0);
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
    `INSERT INTO "public"."Invoice" (id, number, status) VALUES (1, 'A-1', 'open'), (2, 'A-2', 'paid');
     INSERT INTO "public"."Payment" (id, "invoiceId") VALUES (10, 1)`,
  );
}

function expectOnlyTheMove(
  operations: readonly PlannedOperation[],
  applied: readonly AppliedStatementReport[],
  label: string,
): void {
  expect(
    operations.map(({ label: text, operationClass }) => ({ label: text, operationClass })),
    `${label}: the schema is created and the table moved, nothing dropped or created`,
  ).toEqual(MOVE_OPERATIONS);
  expect(applied, `${label}: the statement accounts for the move`).toEqual([
    expect.objectContaining({ operationIndexes: [1] }),
  ]);
}

async function expectMovedState(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(
    connectionString,
    'SELECT id, number FROM "billing"."Invoice" ORDER BY id',
  );
  expect(rows.rows, `${label}: the rows moved with the table`).toEqual([
    { id: 1, number: 'A-1' },
    { id: 2, number: 'A-2' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."Invoice"') AS old,
       (SELECT array_agg(confrelid::regclass::text) FROM pg_constraint
         WHERE conrelid = '"public"."Payment"'::regclass AND contype = 'f') AS payment_references,
       (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'billing' AND tablename = 'Invoice') AS policies,
       (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'billing' AND tablename = 'Invoice') AS indexes`,
  );
  expect(
    live.rows[0],
    `${label}: the old table is gone, and the foreign key, policy and indexes follow`,
  ).toEqual({
    old: null,
    payment_references: ['billing."Invoice"'],
    policies: 1,
    indexes: 3,
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
  describe('Journey M1: move a model to another namespace with migration plan --rename', () => {
    const db = useDevDatabase();

    it(
      'plans the schema creation and the move, re-emits byte for byte, and keeps the rows and the foreign key',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, 'contract-move-statements-from', 'M1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `M1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `M1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, 'contract-move-statements-to', 'M1.04');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'move-invoice',
          '--from',
          origin,
          ...MOVE,
          '--json',
        ]);
        expect(plan.exitCode, `M1.05: plan with the move: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<{
          ok: boolean;
          operations: readonly PlannedOperation[];
          appliedStatements: readonly AppliedStatementReport[];
        }>(plan);
        expectOnlyTheMove(planned.operations, planned.appliedStatements, 'M1.05');

        const moveDir = latestMigrationDirName(ctx);
        const written = packageFiles(ctx, moveDir);
        expect(written.source, 'M1.06: migration.ts holds the facade call').toContain(
          "this.setTableSchema({ schema: 'public', table: 'Invoice', to: 'billing' })",
        );
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${moveDir}`]);
        expect(reEmit.exitCode, `M1.07: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        const reEmitted = packageFiles(ctx, moveDir);
        expect(reEmitted.ops, 'M1.07: ops.json is byte-identical after re-emit').toBe(written.ops);
        expect(reEmitted.migration, 'M1.07: migration.json is byte-identical after re-emit').toBe(
          written.migration,
        );

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `M1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectMovedState(ctx, db.connectionString, 'M1.09');

        const migrationCount = getMigrationDirs(ctx).length;
        const fresh = await runMigrationPlan(ctx, ['--from', moveDir, '--json']);
        expect(fresh.exitCode, `M1.10: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'M1.10: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'M1.10: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey M2: move a model to another namespace with db update --rename', () => {
    const db = useDevDatabase();

    it(
      'moves the table without asking about data loss, and a later dry run plans nothing',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, 'contract-move-statements-from', 'M2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `M2.02: db update creates the tables: ${create.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        await emitContract(ctx, 'contract-move-statements-to', 'M2.03');

        const dryRun = await runDbUpdate(ctx, [...MOVE, '--dry-run', '--json']);
        expect(dryRun.exitCode, `M2.04: db update --dry-run: ${dryRun.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ dataLoss: readonly unknown[] }>(dryRun).dataLoss,
          'M2.04: an apply would ask no data-loss question',
        ).toEqual([]);

        const update = await runDbUpdate(ctx, [...MOVE, '--no-interactive', '--json']);
        expect(update.exitCode, `M2.05: db update with the move: ${update.stderr}`).toBe(0);
        const updated = parseJsonOutput<{
          ok: boolean;
          plan: { operations: readonly PlannedOperation[] };
          appliedStatements: readonly AppliedStatementReport[];
        }>(update);
        expectOnlyTheMove(updated.plan.operations, updated.appliedStatements, 'M2.05');
        await expectMovedState(ctx, db.connectionString, 'M2.06');

        const after = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(after.exitCode, `M2.07: db update --dry-run: ${after.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(after).plan
            .operations,
          'M2.07: nothing left to plan',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
