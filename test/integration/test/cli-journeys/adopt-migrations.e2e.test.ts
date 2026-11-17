/**
 * Adopting Migrations on Production (Journey O — spec scenario P-9/S-9)
 *
 * Simulates a database that has been managed via `db update` and transitions
 * to migration-based management. The baseline migration (EMPTY→current) is a
 * no-op because the DB marker already matches the target. Subsequent
 * migrations apply normally.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  migrationStatusAppSpace,
  parseJsonOutput,
  parseMigrationStatusJson,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationStatus,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey O: Adopting Migrations on Production (P-9/S-9)', () => {
    const db = useDevDatabase();

    it(
      'db update → baseline migration (no-op) → incremental migration applies',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // O.01: emit base (C1) → db update (simulates prior db-update-managed database)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'O.01: emit C1').toBe(0);
        const update0 = await runDbUpdate(ctx);
        expect(update0.exitCode, 'O.01: db update C1').toBe(0);

        // O.02: swap to contract-phone (C2) → emit → db update again
        swapContract(ctx, 'contract-phone');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'O.02: emit C2').toBe(0);
        const update1 = await runDbUpdate(ctx);
        expect(update1.exitCode, 'O.02: db update C2').toBe(0);

        // O.03: plan baseline migration EMPTY→C2 (current contract)
        const planBaseline = await planMigrationAndSelfEmit(ctx, ['--name', 'baseline', '--json']);
        expect(planBaseline.exitCode, 'O.03: plan baseline').toBe(0);
        const baselineResult = parseJsonOutput<{ to: string; noOp: boolean }>(planBaseline);
        expect(baselineResult.noOp, 'O.03: baseline is not a plan-noop').toBe(false);
        const c2Hash = baselineResult.to;

        // O.04: apply baseline → no-op (DB already at C2 from db update)
        const applyBaseline = await runMigrate(ctx, ['--json']);
        expect(applyBaseline.exitCode, 'O.04: apply baseline').toBe(0);
        const applyBaselineResult = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(applyBaseline);
        expect(applyBaselineResult.ok, 'O.04: ok').toBe(true);
        expect(applyBaselineResult.migrationsApplied, 'O.04: baseline is no-op').toBe(0);
        expect(applyBaselineResult.markerHash, 'O.04: marker still at C2').toBe(c2Hash);

        // O.05: swap to contract-phone-bio (C3) → emit → plan incremental C2→C3
        swapContract(ctx, 'contract-phone-bio');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'O.05: emit C3').toBe(0);
        const planIncremental = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-bio',
          '--json',
        ]);
        expect(planIncremental.exitCode, 'O.05: plan C2→C3').toBe(0);
        const incrementalResult = parseJsonOutput<{ from: string; to: string }>(planIncremental);
        expect(incrementalResult.from, 'O.05: from C2').toBe(c2Hash);
        const c3Hash = incrementalResult.to;

        // O.06: apply incremental → advances DB from C2 to C3
        const applyIncremental = await runMigrate(ctx, ['--json']);
        expect(applyIncremental.exitCode, 'O.06: apply incremental').toBe(0);
        const applyIncrementalResult = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(applyIncremental);
        expect(applyIncrementalResult.ok, 'O.06: ok').toBe(true);
        expect(applyIncrementalResult.migrationsApplied, 'O.06: applied 1').toBe(1);
        expect(applyIncrementalResult.markerHash, 'O.06: marker at C3').toBe(c3Hash);

        // O.07: verify status shows both migrations applied
        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, 'O.07: status').toBe(0);
        const statusData = migrationStatusAppSpace(parseMigrationStatusJson(status));
        expect(statusData.migrations.length, 'O.07: 2 migrations total').toBe(2);
        const pendingCount = statusData.migrations.filter((m) => m.status === 'pending').length;
        expect(pendingCount, 'O.07: 0 pending').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
