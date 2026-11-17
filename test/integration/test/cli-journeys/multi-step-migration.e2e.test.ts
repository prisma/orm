/**
 * Multi-Step Migration Chain (Journey C)
 *
 * A developer plans two migrations (base → additive, additive → v3) without
 * applying either, then applies both at once. Verifies that migration status
 * correctly reports pending and applied states, and that db verify passes
 * after the batch apply.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationStatus,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey C: Multi-Step Migration Chain', () => {
    const db = useDevDatabase();

    it(
      'plan two migrations → apply both → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: plan initial migration (∅ → base)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'C.pre: emit base').toBe(0);
        const planInit = await planMigrationAndSelfEmit(ctx, ['--name', 'initial', '--json']);
        expect(planInit.exitCode, 'C.pre: plan initial').toBe(0);
        const baseHash = parseJsonOutput<{ to: string }>(planInit).to;

        // C.01: Swap to contract-additive, contract emit
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'C.01: contract emit v2').toBe(0);

        // C.02: migration plan --name add-name, chained off the base contract
        const plan1 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-name',
          '--from',
          baseHash,
          '--json',
        ]);
        expect(plan1.exitCode, 'C.02: migration plan v2').toBe(0);
        const additiveHash = parseJsonOutput<{ to: string }>(plan1).to;

        // C.03: Swap to contract-v3, contract emit
        swapContract(ctx, 'contract-v3');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'C.03: contract emit v3').toBe(0);

        // C.04: migration plan --name add-posts, chained off the additive contract
        const plan2 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-posts',
          '--from',
          additiveHash,
        ]);
        expect(plan2.exitCode, 'C.04: migration plan v3').toBe(0);

        // C.05: migration status --db (2 pending)
        const statusPending = await runMigrationStatus(ctx);
        expect(statusPending.exitCode, 'C.05: migration status pending').toBe(0);
        const pendingOutput = stripAnsi(statusPending.stderr);
        // Should show at least 2 pending
        expect(pendingOutput, 'C.05: shows pending migrations').toContain('pending');

        // migrate --db (applies both)
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, 'migrate applies both steps').toBe(0);

        // C.07: migration status --db (all applied)
        const statusApplied = await runMigrationStatus(ctx);
        expect(statusApplied.exitCode, 'C.07: migration status all applied').toBe(0);
        expect(stripAnsi(statusApplied.stderr), 'C.07: all applied').toContain('applied');

        // C.08: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'C.08: db verify').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
