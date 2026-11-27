import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  runMigrationCheck,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

function migrationTo(ctx: JourneyContext, dirName: string): string {
  const manifest = JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations', 'app', dirName, 'migration.json'), 'utf-8'),
  ) as { to: string };
  return manifest.to;
}

function snapshotOfMigration(ctx: JourneyContext, dirName: string): string {
  return join(ctx.testDir, 'migrations', 'snapshots', migrationTo(ctx, dirName), 'contract.json');
}

/** Adds a key no reader of this release accepts, as a snapshot an earlier release wrote can hold. */
function makeUnreadable(path: string): void {
  const json = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...json, writtenByAnEarlierRelease: true }));
}

withTempDir(({ createTempDir }) => {
  describe('db migrate with a snapshot this release cannot read, of a migration other migrations follow', () => {
    it(
      'migrates an empty database, and migration check passes',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = setupJourney({ connectionString, createTempDir });
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
          const initial = getLatestMigrationDir(ctx) ?? '';
          swapContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect(
            (
              await planMigrationAndSelfEmit(ctx, [
                '--name',
                'add-name',
                '--from',
                migrationTo(ctx, initial),
              ])
            ).exitCode,
          ).toBe(0);
          makeUnreadable(snapshotOfMigration(ctx, initial));

          const check = await runMigrationCheck(ctx);
          const migrate = await runMigrate(ctx, ['--no-advance-ref']);

          expect(
            { check: check.exitCode, migrate: migrate.exitCode },
            `${check.stdout}${check.stderr}${migrate.stdout}${migrate.stderr}`,
          ).toEqual({ check: 0, migrate: 0 });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'migrates a database already past that snapshot',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = setupJourney({ connectionString, createTempDir });
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
          const initial = getLatestMigrationDir(ctx);
          expect((await runMigrate(ctx, ['--advance-ref', 'db'])).exitCode).toBe(0);
          swapContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          expect((await planMigrationAndSelfEmit(ctx, ['--name', 'add-name'])).exitCode).toBe(0);
          makeUnreadable(snapshotOfMigration(ctx, initial ?? ''));

          const migrate = await runMigrate(ctx, ['--no-advance-ref']);

          expect(migrate.exitCode, `${migrate.stdout}${migrate.stderr}`).toBe(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
