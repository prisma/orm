/**
 * Database policies on PostgreSQL alone: a database that changes only through migrations, whose
 * marker is outside the migration graph, is told to author migrations rather than run `db update`.
 */

import { readFileSync, rmSync } from 'node:fs';
import { writeRef } from '@internal/migration-tools/refs';
import { createPostgresControlClient } from '@internal/postgres/control';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { errorOf, MIGRATE_ONLY_DECLARED } from './utils/database-policies-journey';
import {
  getLatestMigrationDir,
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

function migrationTo(ctx: JourneyContext, dirName: string): string {
  const manifest = JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations', 'app', dirName, 'migration.json'), 'utf-8'),
  ) as { readonly to: string };
  return manifest.to;
}

withTempDir(({ createTempDir }) => {
  describe('database policies (PostgreSQL only)', () => {
    it(
      'gives only the migrations recovery for a marker outside the graph on a migrations-only database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = setupJourney({ connectionString, createTempDir });
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
          await writeRef(join(ctx.testDir, 'migrations', 'app', 'refs'), 'production', {
            hash: markerHash,
            invariants: [],
            policies: MIGRATE_ONLY_DECLARED,
          });
          const recorded = await runMigrate(ctx, ['--to', 'production', '--permit-policy-change']);
          expect(recorded.exitCode, `${recorded.stdout}\n${recorded.stderr}`).toBe(0);

          rmSync(join(ctx.testDir, 'migrations', 'app', deleted), { recursive: true, force: true });
          rmSync(join(ctx.testDir, 'migrations', 'app', 'refs', 'production.json'));
          swapContract(ctx, 'contract-phone');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-phone'])).exitCode).toBe(0);
          const targetHash = migrationTo(ctx, getLatestMigrationDir(ctx)!);

          const drift = await runMigrate(ctx, ['--json']);

          const recovery = `This database's change policy permits only migrations. Author migrations that bring it back onto the graph: one from ${initialHash} to its current contract, then one from there to ${targetHash}. Commit them and deploy again.`;
          expect(errorOf(drift)).toEqual({
            code: 'MIGRATION.MARKER_MISMATCH',
            severity: 'error',
            docsUrl:
              'https://docs.prisma.io/docs/orm/v8/reference/error-reference/MIGRATION.MARKER_MISMATCH',
            summary: 'The database is at a contract that is not in the migration graph',
            why: `The database's marker names ${markerHash}, which no migration in migrations/app starts or ends at. After ${initialHash}, the last graph contract it reached, it applied ${deleted}, which is no longer on disk.`,
            nextActions: [{ kind: 'user-choice', label: recovery }],
            meta: {
              spaceId: 'app',
              markerHash,
              targetHash,
              change: ['migrate'],
              lastGraphHash: initialHash,
              missingMigrations: [deleted],
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports a marker outside the graph before a mismatching ref, through db migrate and the control API alike',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = setupJourney({ connectionString, createTempDir });
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
          expect((await runMigrate(ctx, ['--advance-ref', 'db'])).exitCode).toBe(0);
          swapContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-name'])).exitCode).toBe(0);
          const deleted = getLatestMigrationDir(ctx)!;
          expect((await runMigrate(ctx)).exitCode).toBe(0);
          rmSync(join(ctx.testDir, 'migrations', 'app', deleted), { recursive: true, force: true });
          swapContract(ctx, 'contract-phone');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-phone'])).exitCode).toBe(0);
          const targetHash = migrationTo(ctx, getLatestMigrationDir(ctx)!);
          const production = {
            hash: targetHash,
            invariants: [],
            policies: MIGRATE_ONLY_DECLARED,
          };
          await writeRef(join(ctx.testDir, 'migrations', 'app', 'refs'), 'production', production);

          const throughCli = await runMigrate(ctx, ['--to', 'production', '--json']);
          const client = createPostgresControlClient({ connection: connectionString });
          const throughControlApi = await client
            .migrate({
              contract: JSON.parse(
                readFileSync(join(ctx.testDir, 'output', 'contract.json'), 'utf-8'),
              ),
              migrationsDir: join(ctx.testDir, 'migrations'),
              invocation: { cwd: ctx.testDir, configPath: undefined, dbGiven: false },
              ref: { name: 'production', ...production },
            })
            .finally(() => client.close());

          expect({
            cli: errorOf(throughCli)['code'],
            controlApi: throughControlApi.ok ? undefined : throughControlApi.failure.code,
          }).toEqual({
            cli: 'MIGRATION.MARKER_MISMATCH',
            controlApi: 'MIGRATION.MARKER_MISMATCH',
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
