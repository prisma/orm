import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runMigrate,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

/** The typed remediation as one blob, so a regex can look for a named command. */
function remediation(error: MigrateErrorJson): string {
  return (error.nextActions ?? [])
    .map((action) => `${action.label} ${action.command ?? ''}`)
    .join('\n');
}

interface MigrateErrorJson {
  readonly ok?: boolean;
  readonly code?: string;
  readonly meta?: {
    readonly markerHash?: string;
    readonly reachableHashes?: readonly string[];
    readonly graphTip?: string;
    readonly fromHash?: string;
    readonly targetHash?: string;
    readonly kind?: string;
  };
  readonly nextActions?: readonly { readonly label: string; readonly command?: string }[];
  readonly why?: string;
}

function appMigrationsDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app');
}

function removeAppMigrationBundles(ctx: JourneyContext): void {
  const dir = appMigrationsDir(ctx);
  for (const name of readdirSync(dir)) {
    if (name === 'refs' || name.startsWith('.')) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
  }
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
  describe('migrate pre-DDL drift check (e2e)', () => {
    it(
      'refuses cold-clone drift when the live marker is not in the on-disk graph',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
            const firstApply = await runMigrate(ctx, ['--json']);
            expect(firstApply.exitCode).toBe(0);
            const firstJson = parseJsonOutput<{ markerHash: string }>(firstApply);
            const staleMarker = firstJson.markerHash;

            removeAppMigrationBundles(ctx);
            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'replacement'])).exitCode).toBe(
              0,
            );

            const drift = await runMigrate(ctx, ['--json']);
            expect(drift.exitCode).not.toBe(0);
            const err = parseJsonOutput<MigrateErrorJson>(drift);
            expect(err.code).toBe('MIGRATION.MARKER_MISMATCH');
            expect(err.meta?.markerHash).toBe(staleMarker);
            expect(err.meta?.reachableHashes?.length).toBeGreaterThan(0);
            expect(err.meta?.reachableHashes).not.toContain(staleMarker);
            expect(remediation(err)).toMatch(/migration plan/);
            expect(remediation(err)).toMatch(/ref set db/);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'proceeds on re-run when the marker already matches a graph node',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
            expect((await runMigrate(ctx, ['--json'])).exitCode).toBe(0);
            const second = await runMigrate(ctx, ['--json']);
            expect(second.exitCode).toBe(0);
            const json = parseJsonOutput<{ ok: boolean }>(second);
            expect(json.ok).toBe(true);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'proceeds on greenfield when no app marker is present',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
            const apply = await runMigrate(ctx, ['--json']);
            expect(apply.exitCode).toBe(0);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses when a marker is present but the on-disk graph is empty',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await runDbInit(ctx)).exitCode).toBe(0);

            const drift = await runMigrate(ctx, ['--json']);
            expect(drift.exitCode).not.toBe(0);
            const err = parseJsonOutput<MigrateErrorJson>(drift);
            expect(err.code).toBe('MIGRATION.MARKER_MISMATCH');
            expect(err.meta?.markerHash).toMatch(/^[a-f0-9]{64}$/);
            expect(err.meta?.reachableHashes).toEqual([]);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'runs the drift check before --to resolution when the marker drifted',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
            expect((await runMigrate(ctx)).exitCode).toBe(0);

            removeAppMigrationBundles(ctx);
            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            const replacementPlan = await planMigrationAndSelfEmit(ctx, ['--name', 'replacement']);
            expect(replacementPlan.exitCode).toBe(0);
            const bundleDir = readdirSync(appMigrationsDir(ctx))
              .filter((d) => d !== 'refs' && !d.startsWith('.'))
              .sort()
              .at(-1)!;

            const drift = await runMigrate(ctx, ['--to', bundleDir, '--json']);
            expect(drift.exitCode).not.toBe(0);
            const err = parseJsonOutput<MigrateErrorJson>(drift);
            expect(err.code).toBe('MIGRATION.MARKER_MISMATCH');
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'surfaces PATH_UNREACHABLE with actionable fix when the graph walk cannot reach the target',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
            expect((await runMigrate(ctx, ['--advance-ref', 'db'])).exitCode).toBe(0);

            swapContract(ctx, 'contract-additive');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);
            expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-name'])).exitCode).toBe(0);

            swapContract(ctx, 'contract-phone');
            expect((await runContractEmit(ctx)).exitCode).toBe(0);

            const unreachable = await runMigrate(ctx, ['--json']);
            expect(unreachable.exitCode).not.toBe(0);
            const err = parseJsonOutput<MigrateErrorJson>(unreachable);
            expect(err.code).toBe('MIGRATION.PATH_UNREACHABLE');
            expect(err.meta?.kind).toBe('pathUnreachable');
            expect(remediation(err)).toMatch(/migration list/);
            expect(remediation(err)).toMatch(/migration plan/);
            expect(remediation(err)).toMatch(/migration show/);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
