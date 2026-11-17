import { timeouts, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runMigrationPlan,
  setupJourney,
  swapContract,
} from './utils/journey-test-helpers';

const NOTICE =
  'No db ref set — planning from an empty database. Run db init, db update, or db sign if a database already exists.';

async function emittedProject(
  createTempDir: () => string,
  connectionString?: string,
): Promise<JourneyContext> {
  const ctx = setupJourney({ createTempDir, ...(connectionString ? { connectionString } : {}) });
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);
  return ctx;
}

withTempDir(({ createTempDir }) => {
  describe('migration plan greenfield notice (e2e)', () => {
    it('explains the empty origin when no db ref exists and the graph is empty', async () => {
      const ctx = await emittedProject(createTempDir);

      const plan = await runMigrationPlan(ctx, ['--name', 'init']);

      expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);
      expect(stripAnsi(plan.stderr)).toContain(NOTICE);
    });

    it(
      'stays silent once db init has set the ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await emittedProject(createTempDir, connectionString);
          const init = await runDbInit(ctx);
          expect(init.exitCode, stripAnsi(init.stderr)).toBe(0);
          swapContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);

          const plan = await runMigrationPlan(ctx, ['--name', 'add-name']);

          expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);
          expect(stripAnsi(plan.stderr)).not.toContain(NOTICE);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it('stays silent when --from @empty names the origin', async () => {
      const ctx = await emittedProject(createTempDir);

      const plan = await runMigrationPlan(ctx, ['--from', '@empty', '--name', 'init']);

      expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);
      expect(stripAnsi(plan.stderr)).not.toContain(NOTICE);
    });
  });
});
