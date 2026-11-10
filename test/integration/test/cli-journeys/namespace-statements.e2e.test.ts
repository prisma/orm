/**
 * Namespace statements on Postgres.
 *
 * Namespace `billing` holds `Invoice` (rows, a unique field, a secondary index, row-level security with a policy) and `Receipt`, whose foreign key references `Invoice`.
 *
 * `--rename billing:finance` renames the schema with `ALTER SCHEMA … RENAME TO`, and `--rename billing.Invoice:finance.Bill` in the same run renames the table inside it: N1 through `migration plan` and `migrate`, N2 through `db update`.
 *
 * A namespace the destination no longer declares is asked about one model at a time, and the refusal says that `--delete billing` answers them all. N3 answers with `--delete billing` through `db update`; N4 answers with one `--delete` per model through `migration plan`. N5 and N6 keep `Invoice` by moving it to `public` in the same run, through `db update` and `migration plan`. N7 adds a table no contract declares to `billing`: it is its own question, answered by its storage name. N8 refuses to rename `public` through both commands, then follows the refusal's advice and moves `User` to `app`, so the contract no longer declares `public`; N9 does the same move through `db update`. Each then plans nothing more.
 *
 * Every journey ends with `db verify --schema-only` clean and a further plan empty, and every `migration.ts` written is run again and reproduces its `ops.json` and `migration.json` byte for byte.
 */

import { readFileSync } from 'node:fs';
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

type Variant =
  | 'contract-namespace-statements-from'
  | 'contract-namespace-statements-renamed'
  | 'contract-namespace-statements-removed'
  | 'contract-namespace-statements-kept'
  | 'contract-namespace-statements-public-renamed';

interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

interface AppliedStatementReport {
  readonly description: string;
  readonly operationIndexes: readonly number[];
}

const RENAME = ['--rename', 'billing:finance', '--rename', 'billing.Invoice:finance.Bill'] as const;
const KEEP = ['--delete', 'billing', '--rename', 'billing.Invoice:public.Invoice'] as const;
const MOVE_USER = ['--rename', 'User:app.User'] as const;

async function createAppUserRole(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    'DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );
}

async function emitContract(ctx: JourneyContext, variant: Variant, label: string): Promise<void> {
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit ${variant}: ${emit.stderr}`).toBe(0);
}

async function seedRows(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    `INSERT INTO "billing"."Invoice" (id, number, status) VALUES (1, 'A-1', 'open'), (2, 'A-2', 'paid');
     INSERT INTO "billing"."Receipt" (id, "invoiceId") VALUES (10, 1)`,
  );
}

/** A journey whose database holds the origin contract with rows, set up by `migrate` or `db update`. */
async function startAt(
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

async function schemas(connectionString: string): Promise<readonly string[]> {
  const rows = await sql(
    connectionString,
    `SELECT nspname FROM pg_namespace WHERE nspname IN ('billing', 'finance') ORDER BY nspname`,
  );
  return rows.rows.map((row) => String(row['nspname']));
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

/** Plans with `statements`, re-runs the written `migration.ts`, and migrates. */
async function planReEmitAndMigrate(
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
async function expectSettled(
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

async function expectRenamedState(connectionString: string, label: string): Promise<void> {
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

async function expectKeptInvoice(connectionString: string, label: string): Promise<void> {
  expect(await schemas(connectionString), `${label}: billing is gone`).toEqual([]);
  expect(
    (await sql(connectionString, 'SELECT id, number FROM "public"."Invoice" ORDER BY id')).rows,
    `${label}: Invoice kept its rows in public`,
  ).toEqual([
    { id: 1, number: 'A-1' },
    { id: 2, number: 'A-2' },
  ]);
}

async function expectUserMovedOutOfPublic(connectionString: string, label: string) {
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

function nextActionsOf(result: Parameters<typeof engineError>[0]): string {
  return JSON.stringify(engineError(result)?.nextActions ?? []);
}

withTempDir(({ createTempDir }) => {
  describe('N1: rename a namespace and a model in it with migration plan', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, then the table in it, and keeps every row and object',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N1');
        await emitContract(ctx, 'contract-namespace-statements-renamed', 'N1.03');

        const planned = await planReEmitAndMigrate(ctx, origin ?? '', RENAME, 'N1.04');
        expect(planned.operations.slice(0, 2).map(({ label }) => label)).toEqual([
          'Rename schema "billing" to "finance"',
          'Rename table "Invoice" to "Bill"',
        ]);
        expect(
          planned.operations.filter(({ operationClass }) => operationClass !== 'widening'),
          'N1.04: renames only',
        ).toEqual([]);
        expect(planned.appliedStatements.map(({ description }) => description)).toEqual([
          'rename namespace "billing" to "finance"',
          'rename model "billing.Invoice" to "finance.Bill"',
        ]);
        expect(planned.source).toContain("this.renameSchema({ schema: 'billing', to: 'finance' })");

        await expectRenamedState(db.connectionString, 'N1.05');
        await expectSettled(ctx, 'migrate', planned.dirName, 'N1.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N2: rename a namespace and a model in it with db update', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, then the table in it, without asking anything',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N2');
        await emitContract(ctx, 'contract-namespace-statements-renamed', 'N2.03');

        const update = await runDbUpdate(ctx, [...RENAME, '--no-interactive', '--json']);
        expect(update.exitCode, `N2.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectRenamedState(db.connectionString, 'N2.05');
        await expectSettled(ctx, 'db update', undefined, 'N2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N3: delete a removed namespace with db update --delete billing', () => {
    const db = useDevDatabase();

    it(
      'is refused with the flags that answer, then drops the tables and the schema',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N3');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N3.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'N3.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionsOf(refused), 'N3.04: one flag per model').toContain(
          '--delete billing.Invoice',
        );
        expect(nextActionsOf(refused)).toContain('--delete billing.Receipt');
        expect(
          engineError(refused)?.why,
          'N3.04: says --delete billing answers them all',
        ).toContain(
          '--delete billing answers this question and every other about a model or field of namespace "billing", which the destination contract no longer has.',
        );
        expect(await schemas(db.connectionString), 'N3.04: nothing dropped').toEqual(['billing']);

        const update = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--no-interactive',
          '--json',
        ]);
        expect(
          update.exitCode,
          `N3.05: db update --delete billing: ${JSON.stringify(engineError(update))}`,
        ).toBe(0);
        const updated = parseJsonOutput<{
          plan: { operations: readonly PlannedOperation[] };
          appliedStatements: readonly AppliedStatementReport[];
        }>(update);
        expect(updated.plan.operations.map(({ label }) => label).at(-1)).toBe(
          'Drop schema "billing"',
        );
        expect(updated.appliedStatements.map(({ description }) => description).sort()).toEqual([
          'delete model "billing.Invoice"',
          'delete model "billing.Receipt"',
        ]);
        expect(await schemas(db.connectionString), 'N3.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'db update', undefined, 'N3.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N4: delete a removed namespace with migration plan, one --delete per model', () => {
    const db = useDevDatabase();

    it(
      'is refused, then plans the drops and the schema drop with the per-model flags',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N4');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N4.03');

        const refused = await runMigrationPlan(ctx, ['--from', origin ?? '', '--json']);
        expect(engineError(refused)?.code, 'N4.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionsOf(refused)).toContain('--delete billing.Invoice');
        expect(nextActionsOf(refused)).toContain('--delete billing.Receipt');

        const planned = await planReEmitAndMigrate(
          ctx,
          origin ?? '',
          ['--delete', 'billing.Invoice', '--delete', 'billing.Receipt'],
          'N4.05',
        );
        expect(planned.operations.map(({ label }) => label).at(-1)).toBe('Drop schema "billing"');
        expect(planned.source).toContain("this.dropSchema({ schema: 'billing' })");
        expect(await schemas(db.connectionString), 'N4.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'migrate', planned.dirName, 'N4.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N5: keep one model of a removed namespace with db update', () => {
    const db = useDevDatabase();

    it(
      'moves Invoice to public and deletes the rest of billing',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N5');
        await emitContract(ctx, 'contract-namespace-statements-kept', 'N5.03');

        const update = await runDbUpdate(ctx, [...KEEP, '--no-interactive', '--json']);
        expect(update.exitCode, `N5.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectKeptInvoice(db.connectionString, 'N5.05');
        await expectSettled(ctx, 'db update', undefined, 'N5.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N6: keep one model of a removed namespace with migration plan', () => {
    const db = useDevDatabase();

    it(
      'moves Invoice to public and deletes the rest of billing',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N6');
        await emitContract(ctx, 'contract-namespace-statements-kept', 'N6.03');

        const planned = await planReEmitAndMigrate(ctx, origin ?? '', KEEP, 'N6.04');
        expect(planned.source).toContain(
          "this.setTableSchema({ schema: 'billing', table: 'Invoice', to: 'public' })",
        );

        await expectKeptInvoice(db.connectionString, 'N6.05');
        await expectSettled(ctx, 'migrate', planned.dirName, 'N6.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N7: a removed namespace with a table no contract declares', () => {
    const db = useDevDatabase();

    it(
      'asks about that table by its storage name, which --delete billing does not answer',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N7');
        await sql(db.connectionString, 'CREATE TABLE "billing"."audit_log" (id int PRIMARY KEY)');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N7.03');

        const refused = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--no-interactive',
          '--json',
        ]);
        expect(engineError(refused)?.code, 'N7.04: the table is still in question').toBe(
          'CLI.CONSENT_REQUIRED',
        );
        expect(nextActionsOf(refused)).toContain('--delete billing.audit_log');

        const update = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--delete',
          'billing.audit_log',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `N7.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
        expect(await schemas(db.connectionString), 'N7.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'db update', undefined, 'N7.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N8: public cannot be renamed', () => {
    const db = useDevDatabase();

    it(
      'refuses --rename public:app through both commands, and says to move the models',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N8');
        await emitContract(ctx, 'contract-namespace-statements-public-renamed', 'N8.03');
        const summary =
          'Cannot rename namespace "public" to "app": "public" is the default schema of every Postgres database';
        const fix =
          'Prisma owns schema "public", and Postgres puts it on every search path, so a migration does not rename it. Move each model to the new namespace with --rename <Model>:app.<Model> instead.';

        for (const result of [
          await runMigrationPlan(ctx, ['--from', origin ?? '', '--rename', 'public:app', '--json']),
          await runDbUpdate(ctx, ['--rename', 'public:app', '--no-interactive', '--json']),
        ]) {
          expect(result.exitCode, 'N8.04: refused').not.toBe(0);
          const error = engineError(result);
          expect(error?.code).toBe('MIGRATION.PLANNING_FAILED');
          expect(error?.why).toBe(summary);
          expect(error?.nextActions?.map(({ label }) => label)).toEqual([fix]);
        }

        const moved = await planReEmitAndMigrate(ctx, origin ?? '', MOVE_USER, 'N8.05');
        expect(moved.operations.map(({ label }) => label)).toEqual([
          'Create schema "app"',
          'Move table "User" to schema "app"',
        ]);
        await expectUserMovedOutOfPublic(db.connectionString, 'N8.06');
        await expectSettled(ctx, 'migrate', moved.dirName, 'N8.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N9: move the last model out of public with db update', () => {
    const db = useDevDatabase();

    it(
      'follows the advice of the public refusal, and a further run plans nothing',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N9');
        await emitContract(ctx, 'contract-namespace-statements-public-renamed', 'N9.03');

        const update = await runDbUpdate(ctx, [...MOVE_USER, '--no-interactive', '--json']);
        expect(update.exitCode, `N9.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectUserMovedOutOfPublic(db.connectionString, 'N9.05');
        await expectSettled(ctx, 'db update', undefined, 'N9.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
