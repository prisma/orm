import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

const JOURNEY_FIXTURES_DIR = join(
  import.meta.dirname,
  'fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys',
);

function writeCompositePkContract(ctx: JourneyContext): void {
  writeFileSync(
    join(ctx.testDir, 'contract.ts'),
    `import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

const User = model('User', {
  fields: {
    id: field.column(int4Column),
    email: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.id, fields.email]),
  }))
  .sql({ table: 'user' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  createNamespace: postgresCreateNamespace,
  models: { User },
});
`,
    'utf-8',
  );
}

interface MigrationManifest {
  readonly from: string | null;
  readonly to: string;
}

interface PlanJsonResult {
  readonly ok?: boolean;
  readonly from: string | null;
  readonly to: string;
  readonly dir?: string;
  readonly baselineDir?: string;
  readonly noOp?: boolean;
}

function appMigrationsDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app');
}

function refsDir(ctx: JourneyContext): string {
  return join(appMigrationsDir(ctx), 'refs');
}

function readManifest(ctx: JourneyContext, dirName: string): MigrationManifest {
  const raw = readFileSync(join(appMigrationsDir(ctx), dirName, 'migration.json'), 'utf-8');
  return JSON.parse(raw) as MigrationManifest;
}

function readDbRefHash(ctx: JourneyContext): string {
  const raw = readFileSync(join(refsDir(ctx), 'db.json'), 'utf-8');
  return (JSON.parse(raw) as { hash: string }).hash;
}

function dbRefSnapshotExists(ctx: JourneyContext): boolean {
  const storeDir = contractSnapshotDir(join(ctx.testDir, 'migrations'), readDbRefHash(ctx));
  return (
    existsSync(join(storeDir, 'contract.json')) &&
    existsSync(join(storeDir, 'contract.d.ts')) &&
    statSync(join(storeDir, 'contract.json')).size > 0
  );
}

function listAppMigrationBundleDirs(ctx: JourneyContext): string[] {
  return getMigrationDirs(ctx).filter((d) => d !== 'refs');
}

async function emitAllAppMigrations(ctx: JourneyContext): Promise<void> {
  for (const dir of listAppMigrationBundleDirs(ctx)) {
    const result = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dir}`]);
    expect(result.exitCode, `emit ${dir}`).toBe(0);
  }
}

async function runAutoBaselinePlanAndEmit(
  ctx: JourneyContext,
  extraArgs: readonly string[] = [],
): Promise<ReturnType<typeof runMigrationPlan>> {
  const planResult = await runMigrationPlan(ctx, extraArgs);
  if (planResult.exitCode !== 0) {
    return planResult;
  }
  await emitAllAppMigrations(ctx);
  return planResult;
}

async function seedDevToShipTrap(ctx: JourneyContext): Promise<{ dbRefHash: string }> {
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await runDbInit(ctx)).exitCode).toBe(0);

  swapContract(ctx, 'contract-additive');
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await runDbUpdate(ctx)).exitCode).toBe(0);

  swapContract(ctx, 'contract-phone');
  expect((await runContractEmit(ctx)).exitCode).toBe(0);

  return { dbRefHash: readDbRefHash(ctx) };
}

function setupExtensionJourney(
  connectionString: string,
  createTempDir: () => string,
): JourneyContext {
  const ctx = setupJourney({ connectionString, createTempDir });
  copyFileSync(join(JOURNEY_FIXTURES_DIR, 'contract-base.ts'), join(ctx.testDir, 'contract.ts'));
  writeFileSync(
    ctx.configPath,
    `import postgresAdapter from '@internal/adapter-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { contract } from './contract';

export default definePrismaConfig({
  orm: {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [pgvector],
  contract: {
    source: {
      load: async () => ({ ok: true as const, value: contract }),
    },
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    connection: ${JSON.stringify(connectionString)},
  },
  migrations: {
    dir: 'migrations',
  },
},
});
`,
    'utf-8',
  );
  return ctx;
}

// Simulates a store entry that has gone missing (e.g. `migrations/snapshots/`
// was not restored from version control) while the db ref's pointer still
// exists and still names that hash.
function stripDbSnapshot(ctx: JourneyContext): void {
  const storeDir = contractSnapshotDir(join(ctx.testDir, 'migrations'), readDbRefHash(ctx));
  rmSync(storeDir, { recursive: true, force: true });
}

async function withJourney(
  createTempDir: () => string,
  connectionString: string,
  fn: (ctx: JourneyContext) => Promise<void>,
): Promise<void> {
  const ctx = setupJourney({ connectionString, createTempDir });
  await fn(ctx);
}

withTempDir(({ createTempDir }) => {
  describe('migration plan ref-aware resolution (e2e)', () => {
    it(
      'J4 reproduction: auto-baseline pair applies via migrate',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            const { dbRefHash } = await seedDevToShipTrap(ctx);

            const plan = await runMigrationPlan(ctx, ['--name', 'add-phone', '--json']);
            expect(plan.exitCode).toBe(0);
            const planJson = parseJsonOutput<PlanJsonResult>(plan);
            expect(planJson.baselineDir).toBeDefined();
            expect(planJson.dir).toBeDefined();
            expect(planJson.baselineDir! < planJson.dir!).toBe(true);

            const dirs = listAppMigrationBundleDirs(ctx);
            expect(dirs).toHaveLength(2);
            expect(dirs[0]! < dirs[1]!).toBe(true);

            const baselineMeta = readManifest(ctx, dirs[0]!);
            const deltaMeta = readManifest(ctx, dirs[1]!);
            expect(baselineMeta.from).toBeNull();
            expect(baselineMeta.to).toBe(dbRefHash);
            expect(deltaMeta.from).toBe(dbRefHash);
            expect(deltaMeta.to).toBe(planJson.to);

            await emitAllAppMigrations(ctx);
            const apply = await runMigrate(ctx, ['--advance-ref', 'db', '--json']);
            expect(apply.exitCode).toBe(0);
            const applyJson = parseJsonOutput<{
              ok: boolean;
              migrationsApplied: number;
              markerHash: string;
              advancedRef: { name: string; hash: string } | null;
            }>(apply);
            expect(applyJson.ok).toBe(true);
            expect(applyJson.migrationsApplied).toBeGreaterThanOrEqual(1);
            expect(applyJson.markerHash).toBe(planJson.to);
            expect(applyJson.advancedRef).toEqual({
              name: 'db',
              hash: planJson.to,
            });
            expect(readDbRefHash(ctx)).toBe(planJson.to);
            expect(dbRefSnapshotExists(ctx)).toBe(true);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'implicit db resolution produces single delta when graph is non-empty',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            await seedDevToShipTrap(ctx);
            expect(
              (await runAutoBaselinePlanAndEmit(ctx, ['--name', 'trap-close', '--json'])).exitCode,
            ).toBe(0);
            expect((await runMigrate(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-phone');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);

            const dbRefHash = readDbRefHash(ctx);
            const plan = await runMigrationPlan(ctx, ['--json']);
            expect(plan.exitCode).toBe(0);
            const planJson = parseJsonOutput<PlanJsonResult>(plan);
            expect(planJson.baselineDir).toBeUndefined();
            expect(listAppMigrationBundleDirs(ctx)).toHaveLength(3);
            expect(planJson.from).toBe(dbRefHash);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'explicit --from staging ref resolves through the snapshot store',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbInit(ctx, ['--advance-ref', 'staging'])).exitCode).toBe(0);

            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect(
              (
                await runAutoBaselinePlanAndEmit(ctx, [
                  '--from',
                  'staging',
                  '--name',
                  'init',
                  '--json',
                ])
              ).exitCode,
            ).toBe(0);
            expect((await runMigrate(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-phone');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);

            const stagingHash = JSON.parse(
              readFileSync(join(refsDir(ctx), 'staging.json'), 'utf-8'),
            ).hash;
            const plan = await runMigrationPlan(ctx, [
              '--from',
              'staging',
              '--name',
              'from-staging',
              '--json',
            ]);
            expect(plan.exitCode).toBe(0);
            const planJson = parseJsonOutput<PlanJsonResult>(plan);
            expect(planJson.from).toBe(stagingHash);
            expect(planJson.baselineDir).toBeUndefined();
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'explicit --from graph-node hash uses bundle contract source',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
            expect(plan0.exitCode).toBe(0);
            const c1Hash = parseJsonOutput<{ to: string }>(plan0).to;
            expect((await runMigrate(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            const plan = await runMigrationPlan(ctx, [
              '--from',
              c1Hash,
              '--name',
              'from-hash',
              '--json',
            ]);
            expect(plan.exitCode).toBe(0);
            const planJson = parseJsonOutput<PlanJsonResult>(plan);
            expect(planJson.from).toBe(c1Hash);
            expect(planJson.baselineDir).toBeUndefined();
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses forgot-the-flag when db hash is past the graph tip',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect(
              (await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json'])).exitCode,
            ).toBe(0);
            expect((await runMigrate(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbUpdate(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-phone');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);

            const plan = await runMigrationPlan(ctx, ['--json']);
            expect(plan.exitCode).toBe(2);
            const err = engineError(plan);
            expect(err?.code).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
            expect(JSON.stringify(err?.nextActions)).toMatch(/--from/);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses contract-snapshot-missing when db pointer exists but its store entry is gone',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            await seedDevToShipTrap(ctx);
            stripDbSnapshot(ctx);

            const plan = await runMigrationPlan(ctx, ['--json']);
            expect(plan.exitCode).toBe(2);
            const err = engineError(plan);
            expect(err?.code).toBe('CLI.FILE_NOT_FOUND');
            expect(err?.why).toMatch(/missing its contract snapshot/);
            expect(JSON.stringify(err?.nextActions)).toMatch(/migrations\/snapshots/);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'auto-baseline with extension pack seeds extension space separately from app bundles (pgvector)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = setupExtensionJourney(connectionString, createTempDir);
          expect((await runContractEmit(ctx)).exitCode).toBe(0);

          const plan = await runMigrationPlan(ctx, ['--name', 'initial', '--json']);
          expect(plan.exitCode).toBe(0);
          const planJson = parseJsonOutput<PlanJsonResult & { emittedExtensionDirs?: unknown[] }>(
            plan,
          );
          expect(planJson.emittedExtensionDirs?.length).toBeGreaterThan(0);
          expect(existsSync(join(ctx.testDir, 'migrations', 'pgvector'))).toBe(true);
          expect(listAppMigrationBundleDirs(ctx)).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'keeps baseline on disk when delta planner fails after baseline succeeded',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbInit(ctx)).exitCode).toBe(0);

            writeCompositePkContract(ctx);
            expect((await runContractEmit(ctx)).exitCode).toBe(0);

            const plan = await runMigrationPlan(ctx, ['--name', 'blocked-delta', '--json']);
            expect(plan.exitCode).toBe(2);

            const dirs = listAppMigrationBundleDirs(ctx);
            expect(dirs).toHaveLength(1);
            expect(readManifest(ctx, dirs[0]!).from).toBeNull();
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'dev iteration after db update emits baseline-only and migrate closes the loop',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbInit(ctx)).exitCode).toBe(0);

            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbUpdate(ctx)).exitCode).toBe(0);

            const dbRefHash = readDbRefHash(ctx);
            const plan = await runMigrationPlan(ctx, ['--name', 'ship-baseline', '--json']);
            expect(plan.exitCode).toBe(0);
            const planJson = parseJsonOutput<PlanJsonResult>(plan);
            expect(planJson.noOp).toBe(false);
            expect(planJson.baselineDir).toBeDefined();
            expect(planJson.dir).toBeUndefined();
            expect(planJson.from).toBe(dbRefHash);
            expect(planJson.to).toBe(dbRefHash);

            const dirs = listAppMigrationBundleDirs(ctx);
            expect(dirs).toHaveLength(1);
            const baselineMeta = readManifest(ctx, dirs[0]!);
            expect(baselineMeta.from).toBeNull();
            expect(baselineMeta.to).toBe(dbRefHash);

            await emitAllAppMigrations(ctx);
            const apply = await runMigrate(ctx, ['--advance-ref', 'db', '--json']);
            expect(apply.exitCode).toBe(0);
            const applyJson = parseJsonOutput<{
              ok: boolean;
              migrationsApplied: number;
              markerHash: string;
              advancedRef: { name: string; hash: string } | null;
            }>(apply);
            expect(applyJson.ok).toBe(true);
            expect(applyJson.migrationsApplied).toBe(0);
            expect(applyJson.markerHash).toBe(dbRefHash);
            expect(applyJson.advancedRef).toEqual({ name: 'db', hash: dbRefHash });
            expect(readDbRefHash(ctx)).toBe(dbRefHash);
            expect(dbRefSnapshotExists(ctx)).toBe(true);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'explicit --from db matches implicit default resolution',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            await seedDevToShipTrap(ctx);

            const implicit = await runMigrationPlan(ctx, ['--name', 'implicit', '--json']);
            expect(implicit.exitCode).toBe(0);
            const implicitJson = parseJsonOutput<PlanJsonResult>(implicit);

            const ctx2 = setupJourney({ connectionString, createTempDir });
            await seedDevToShipTrap(ctx2);
            const explicit = await runMigrationPlan(ctx2, [
              '--from',
              'db',
              '--name',
              'explicit',
              '--json',
            ]);
            expect(explicit.exitCode).toBe(0);
            const explicitJson = parseJsonOutput<PlanJsonResult>(explicit);

            expect(explicitJson.from).toBe(implicitJson.from);
            expect(explicitJson.to).toBe(implicitJson.to);
            expect(Boolean(explicitJson.baselineDir)).toBe(Boolean(implicitJson.baselineDir));
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
