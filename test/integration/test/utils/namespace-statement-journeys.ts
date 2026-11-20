/** The contracts, data and checks the namespace statement journeys share. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
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
} from './journey-test-helpers';

export type Variant =
  | 'contract-namespace-statements-from'
  | 'contract-namespace-statements-renamed'
  | 'contract-namespace-statements-removed'
  | 'contract-namespace-statements-kept'
  | 'contract-namespace-statements-public-renamed';

export interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

export interface AppliedStatementReport {
  readonly description: string;
  readonly operationIndexes: readonly number[];
}

export const RENAME = [
  '--rename',
  'billing:finance',
  '--rename',
  'billing.Invoice:finance.Bill',
] as const;
export const KEEP = ['--delete', 'billing', '--rename', 'billing.Invoice:public.Invoice'] as const;
export const MOVE_USER = ['--rename', 'User:app.User'] as const;

export async function createAppUserRole(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    'DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );
}

export async function emitContract(
  ctx: JourneyContext,
  variant: Variant,
  label: string,
): Promise<void> {
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit ${variant}: ${emit.stderr}`).toBe(0);
}

export async function seedRows(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    `INSERT INTO "billing"."Invoice" (id, number, status) VALUES (1, 'A-1', 'open'), (2, 'A-2', 'paid');
     INSERT INTO "billing"."Receipt" (id, "invoiceId") VALUES (10, 1)`,
  );
}

/** A journey whose database holds the origin contract with rows, set up by `migrate` or `db update`. */
export async function startAt(
  db: { readonly connectionString: string },
  createTempDir: () => string,
  via: 'migrate' | 'db update',
  label: string,
): Promise<{ readonly ctx: JourneyContext; readonly origin: string | undefined }> {
  const ctx = setupJourney({
    connectionString: db.connectionString,
    createTempDir,
    contractMode: 'psl',
  });
  await createAppUserRole(db.connectionString);
  await emitContract(ctx, 'contract-namespace-statements-from', `${label}.01`);
  if (via === 'migrate') {
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    const migrate = await runMigrate(ctx);
    expect(migrate.exitCode, `${label}.02: migrate initial: ${migrate.stderr}`).toBe(0);
  } else {
    const create = await runDbUpdate(ctx, ['--json']);
    expect(create.exitCode, `${label}.02: db update creates the tables: ${create.stderr}`).toBe(0);
  }
  await seedRows(db.connectionString);
  return { ctx, origin: via === 'migrate' ? latestMigrationDirName(ctx) : undefined };
}

export async function schemas(connectionString: string): Promise<readonly string[]> {
  const rows = await sql(
    connectionString,
    `SELECT nspname FROM pg_namespace WHERE nspname IN ('billing', 'finance') ORDER BY nspname`,
  );
  return rows.rows.map((row) => String(row['nspname']));
}

export function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

/** Plans with `statements`, re-runs the written `migration.ts`, and migrates. */
export async function planReEmitAndMigrate(
  ctx: JourneyContext,
  origin: string,
  statements: readonly string[],
  label: string,
) {
  const plan = await runMigrationPlan(ctx, [
    '--name',
    'namespace-change',
    '--from',
    origin,
    ...statements,
    '--json',
  ]);
  expect(plan.exitCode, `${label}: plan: ${plan.stderr}`).toBe(0);
  const planned = parseJsonOutput<{
    operations: readonly PlannedOperation[];
    appliedStatements: readonly AppliedStatementReport[];
  }>(plan);
  const dirName = latestMigrationDirName(ctx);
  const written = packageFiles(ctx, dirName);
  const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
  expect(reEmit.exitCode, `${label}: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
  const reEmitted = packageFiles(ctx, dirName);
  expect(reEmitted.ops, `${label}: ops.json is byte-identical after re-emit`).toBe(written.ops);
  expect(reEmitted.migration, `${label}: migration.json is byte-identical`).toBe(written.migration);
  const migrate = await runMigrate(ctx);
  expect(migrate.exitCode, `${label}: migrate: ${migrate.stderr}`).toBe(0);
  return { ...planned, source: written.source, dirName };
}

/** `db verify --schema-only` is clean, and a further plan or dry run plans nothing. */
export async function expectSettled(
  ctx: JourneyContext,
  via: 'migrate' | 'db update',
  from: string | undefined,
  label: string,
): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate' && from !== undefined) {
    const count = getMigrationDirs(ctx).length;
    const fresh = await runMigrationPlan(ctx, ['--from', from, '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    expect(getMigrationDirs(ctx), `${label}: nothing written`).toHaveLength(count);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

export async function expectRenamedState(connectionString: string, label: string): Promise<void> {
  expect(await schemas(connectionString), `${label}: the schema has its new name`).toEqual([
    'finance',
  ]);
  expect(
    (await sql(connectionString, 'SELECT id, number, status FROM "finance"."Bill" ORDER BY id'))
      .rows,
    `${label}: the rows are in the renamed table`,
  ).toEqual([
    { id: 1, number: 'A-1', status: 'open' },
    { id: 2, number: 'A-2', status: 'paid' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       (SELECT array_agg(confrelid::regclass::text) FROM pg_constraint
         WHERE conrelid = '"finance"."Receipt"'::regclass AND contype = 'f') AS receipt_references,
       (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'finance' AND tablename = 'Bill') AS policies,
       (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'finance' AND tablename = 'Bill') AS indexes`,
  );
  expect(live.rows[0], `${label}: the foreign key, policy and indexes follow`).toEqual({
    receipt_references: ['finance."Bill"'],
    policies: 1,
    indexes: 3,
  });
}

export async function expectKeptInvoice(connectionString: string, label: string): Promise<void> {
  expect(await schemas(connectionString), `${label}: billing is gone`).toEqual([]);
  expect(
    (await sql(connectionString, 'SELECT id, number FROM "public"."Invoice" ORDER BY id')).rows,
    `${label}: Invoice kept its rows in public`,
  ).toEqual([
    { id: 1, number: 'A-1' },
    { id: 2, number: 'A-2' },
  ]);
}

export async function expectUserMovedOutOfPublic(connectionString: string, label: string) {
  const tables = await sql(
    connectionString,
    `SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'User' ORDER BY schemaname`,
  );
  expect(tables.rows, `${label}: User is in app only`).toEqual([
    { schemaname: 'app', tablename: 'User' },
  ]);
  const publicSchema = await sql(
    connectionString,
    `SELECT count(*)::int AS schemas FROM pg_namespace WHERE nspname = 'public'`,
  );
  expect(publicSchema.rows[0], `${label}: public stays`).toEqual({ schemas: 1 });
}
