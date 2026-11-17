import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
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
    readonly lastGraphHash?: string;
    readonly missingMigrations?: readonly string[];
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

function migrationTo(ctx: JourneyContext, dirName: string): string {
  const manifest = JSON.parse(
    readFileSync(join(appMigrationsDir(ctx), dirName, 'migration.json'), 'utf-8'),
  ) as { to: string };
  return manifest.to;
}

function removeAppMigrationBundles(ctx: JourneyContext): void {
  const dir = appMigrationsDir(ctx);
  for (const name of readdirSync(dir)) {
    if (name === 'refs' || name.startsWith('.')) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

interface Incident {
  readonly initialHash: string;
  readonly deleted: string;
  readonly markerHash: string;
  readonly targetHash: string;
}

/**
 * A database that applied a migration which was then deleted, in a project whose graph has since
 * moved on to a new target from the migration before it.
 */
async function incidentDatabase(ctx: JourneyContext): Promise<Incident> {
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
  const initialHash = migrationTo(ctx, getLatestMigrationDir(ctx)!);
  expect((await runMigrate(ctx, ['--advance-ref', 'db'])).exitCode).toBe(0);

  swapContract(ctx, 'contract-additive');
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-name'])).exitCode).toBe(0);
  const deleted = getLatestMigrationDir(ctx)!;
  const markerHash = migrationTo(ctx, deleted);
  expect((await runMigrate(ctx)).exitCode).toBe(0);

  rmSync(join(appMigrationsDir(ctx), deleted), { recursive: true, force: true });
  swapContract(ctx, 'contract-phone');
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-phone'])).exitCode).toBe(0);
  const targetHash = migrationTo(ctx, getLatestMigrationDir(ctx)!);
  return { initialHash, deleted, markerHash, targetHash };
}

/** The `db update` arguments of a printed next action, after `<bin> db update`. */
function printedDbUpdateArgs(error: MigrateErrorJson, label: string): readonly string[] {
  const command = error.nextActions?.find((action) => action.label === label)?.command;
  const words = command?.split(' ') ?? [];
  expect(words.slice(1, 3)).toEqual(['db', 'update']);
  return words.slice(3);
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
            expect(err.meta).toMatchObject({ markerHash: staleMarker, missingMigrations: [] });
            expect(err.meta?.lastGraphHash).toBeUndefined();
            expect(remediation(err)).toMatch(/db update/);
            expect(remediation(err)).not.toMatch(/ref set db/);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'explains a marker left by a deleted migration from the ledger, without a reset',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            const { initialHash, deleted, markerHash, targetHash } = await incidentDatabase(ctx);

            const drift = await runMigrate(ctx, ['--json']);

            expect(drift.exitCode).toBe(2);
            expect(parseJsonOutput(drift)).toEqual({
              code: 'MIGRATION.MARKER_MISMATCH',
              severity: 'error',
              docsUrl:
                'https://docs.prisma.io/docs/orm/v8/reference/error-reference/MIGRATION.MARKER_MISMATCH',
              summary: 'The database is at a contract that is not in the migration graph',
              why: `The database's marker names ${markerHash}, which no migration in migrations/app starts or ends at. After ${initialHash}, the last graph contract it reached, it applied ${deleted}, which is no longer on disk.`,
              nextActions: [
                {
                  kind: 'user-choice',
                  label:
                    'Unless this database changes only through migrations, as production does, move it with db update; its data stays:',
                },
                {
                  kind: 'run-command',
                  label: 'Preview the changes',
                  command: `prisma-test db update --to ${targetHash} --dry-run`,
                },
                {
                  kind: 'run-command',
                  label: 'Reconcile the database',
                  command: `prisma-test db update --to ${targetHash}`,
                },
                {
                  kind: 'user-choice',
                  label: `Otherwise plan a migration from ${initialHash} to its current contract, then one to ${targetHash}, and deploy again.`,
                },
              ],
              meta: {
                spaceId: 'app',
                markerHash,
                targetHash,
                lastGraphHash: initialHash,
                missingMigrations: [deleted],
              },
            });
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'brings the incident database to the target with the db update the error prints',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withJourney(createTempDir, connectionString, async (ctx) => {
            const { targetHash } = await incidentDatabase(ctx);
            const refused = parseJsonOutput<MigrateErrorJson>(await runMigrate(ctx, ['--json']));
            expect(refused.code).toBe('MIGRATION.MARKER_MISMATCH');

            const preview = await runDbUpdate(ctx, [
              ...printedDbUpdateArgs(refused, 'Preview the changes'),
              '--json',
            ]);
            expect(preview.exitCode).toBe(0);
            expect(preview.stdout).toContain('User.name');

            const reconciled = await runDbUpdate(ctx, [
              ...printedDbUpdateArgs(refused, 'Reconcile the database'),
              '--delete',
              'User.name',
            ]);
            expect(reconciled.exitCode).toBe(0);

            const migrated = await runMigrate(ctx, ['--json']);
            expect(migrated.exitCode).toBe(0);
            expect(parseJsonOutput<{ markerHash: string }>(migrated).markerHash).toBe(targetHash);
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
            expect(err.meta?.missingMigrations).toEqual([]);
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
