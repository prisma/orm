/**
 * Database policies on PostgreSQL alone: a run whose migration fails leaves the recorded policies
 * as they were, and a database that changes only through migrations, whose marker is outside the
 * migration graph, is told to author migrations rather than run `db update`.
 */

import { readFileSync, rmSync } from 'node:fs';
import { writeRef } from '@internal/migration-tools/refs';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  appMarker,
  errorOf,
  MIGRATE_ONLY_DECLARED,
  planTo,
  setupPolicyProject,
  writePolicyRef,
} from './utils/database-policies-journey';
import {
  getLatestMigrationDir,
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

const DATA_LOSS_PERMITTED_RECORDED = {
  change: ['migrate', 'reconcile'],
  dataProtection: {
    dataLoss: 'data-loss-permitted',
    accessWidening: 'access-widening-with-consent',
  },
};

function migrationTo(ctx: JourneyContext, dirName: string): string {
  const manifest = JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations', 'app', dirName, 'migration.json'), 'utf-8'),
  ) as { readonly to: string };
  return manifest.to;
}

withTempDir(({ createTempDir }) => {
  describe('database policies (PostgreSQL only)', () => {
    it(
      'leaves the recorded policies as they were when the run fails',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupPolicyProject('postgres', createTempDir(), connectionString);
          const base = await planTo(project, 'base', 'initial');
          expect((await runMigrate(project.ctx)).exitCode).toBe(0);
          await writePolicyRef(project, 'production', base, {
            dataProtection: { dataLoss: 'data-loss-permitted' },
          });
          const recorded = await runMigrate(project.ctx, [
            '--to',
            'production',
            '--permit-policy-change',
          ]);
          expect(recorded.exitCode, `${recorded.stdout}\n${recorded.stderr}`).toBe(0);
          await withClient(connectionString, (client) =>
            client.query(`insert into "user" (id, email) values (1, 'a@x.io'), (2, 'a@x.io')`),
          );
          const unique = await planTo(project, 'unique', 'unique-email');
          await writePolicyRef(project, 'production', unique, MIGRATE_ONLY_DECLARED);

          const failed = await runMigrate(project.ctx, [
            '--to',
            'production',
            '--permit-policy-change',
            '--json',
          ]);

          expect(errorOf(failed)).toMatchObject({ meta: { failingSpace: 'app' } });
          const marker = await appMarker(project);
          expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
            storageHash: base,
            meta: { policies: DATA_LOSS_PERMITTED_RECORDED },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

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
  });
});
