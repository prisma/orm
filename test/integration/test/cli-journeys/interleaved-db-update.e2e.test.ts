/**
 * Interleaved db update and migrations (Journey — beyond spec)
 *
 * Tests what happens when a user who has been using migration-based workflow
 * falls back to `db update`, then returns to migrations.
 *
 * The realistic scenario: user changes contract from C2 to C3, runs `db update`
 * instead of `migration plan`. DB advances to C3. They then run `migration plan`
 * which creates the C2→C3 edge (from graph leaf to current contract). Apply sees
 * marker=C3=destination → noop. The migration exists on disk for other environments.
 * Future migrations resume normally.
 */

import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  migrationStatusAppSpace,
  parseJsonOutput,
  parseMigrationStatusJson,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationStatus,
  setupJourney,
  swapContract,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey: Interleaved db update and migrations', () => {
    const db = useDevDatabase();

    it(
      'db update applies schema change, retroactive migration plan catches up, future migrations resume',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // 1. Establish migration workflow: emit C1 → plan init → apply
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, '1: emit C1').toBe(0);
        const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, '1: plan init').toBe(0);
        const c1Hash = parseJsonOutput<{ to: string }>(plan0).to;
        const apply0 = await runMigrate(ctx, ['--json']);
        expect(apply0.exitCode, '1: apply init').toBe(0);
        expect(parseJsonOutput<{ markerHash: string }>(apply0).markerHash, '1: marker at C1').toBe(
          c1Hash,
        );

        // 2. Continue with migrations: C1 → C2 (add phone)
        swapContract(ctx, 'contract-phone');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, '2: emit C2').toBe(0);
        const plan1 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-phone',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan1.exitCode, '2: plan C1→C2').toBe(0);
        const c2Hash = parseJsonOutput<{ to: string }>(plan1).to;
        const apply1 = await runMigrate(ctx, ['--json']);
        expect(apply1.exitCode, '2: apply C2').toBe(0);
        expect(parseJsonOutput<{ markerHash: string }>(apply1).markerHash, '2: marker at C2').toBe(
          c2Hash,
        );

        // 3. User changes contract to C3 and runs `db update` instead of `migration plan`
        //    DB schema + marker advance to C3. Migration graph still has ∅→C1→C2.
        swapContract(ctx, 'contract-phone-bio');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, '3: emit C3').toBe(0);
        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode, '3: db update to C3').toBe(0);
        const c3Hash = parseJsonOutput<{ marker?: { storageHash: string } }>(update).marker
          ?.storageHash;
        expect(c3Hash, '3: marker set by db update').toBeTruthy();

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, '3: db verify passes').toBe(0);

        // 4. Retroactive migration plan: user realizes they should have used migrations.
        //    `migration plan` plans from graph leaf (C2) to current contract (C3).
        //    This is the same edge that db update already applied to the DB.
        const plan2 = await planMigrationAndSelfEmit(ctx, [
          '--from',
          c2Hash,
          '--name',
          'add-bio',
          '--json',
        ]);
        expect(plan2.exitCode, '4: plan C2→C3').toBe(0);
        const plan2Result = parseJsonOutput<{ from: string; to: string }>(plan2);
        expect(plan2Result.from, '4: from is C2 (graph leaf)').toBe(c2Hash);
        expect(plan2Result.to, '4: to is C3 (current contract)').toBe(c3Hash);

        // 5. Apply is a noop: DB marker already at C3, destination is C3
        const apply2 = await runMigrate(ctx, ['--json']);
        expect(apply2.exitCode, '5: apply noop').toBe(0);
        const apply2Result = parseJsonOutput<{
          migrationsApplied: number;
          markerHash: string;
          summary: string;
        }>(apply2);
        expect(apply2Result.migrationsApplied, '5: 0 applied (already there)').toBe(0);
        expect(apply2Result.markerHash, '5: marker still at C3').toBe(c3Hash);

        // 6. Future migrations resume normally: C3 → C4 (add avatar)
        swapContract(ctx, 'contract-all');
        const emit3 = await runContractEmit(ctx);
        expect(emit3.exitCode, '6: emit C4').toBe(0);
        const plan3 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-avatar',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan3.exitCode, '6: plan C3→C4').toBe(0);
        const plan3Result = parseJsonOutput<{ from: string; to: string }>(plan3);
        expect(plan3Result.from, '6: from is C3 (new graph leaf)').toBe(c3Hash);
        const c4Hash = plan3Result.to;

        const apply3 = await runMigrate(ctx, ['--json']);
        expect(apply3.exitCode, '6: apply C3→C4').toBe(0);
        const apply3Result = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(apply3);
        expect(apply3Result.ok, '6: ok').toBe(true);
        expect(apply3Result.migrationsApplied, '6: applied 1').toBe(1);
        expect(apply3Result.markerHash, '6: marker at C4').toBe(c4Hash);

        // 7. Status clean
        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, '7: status').toBe(0);
        const statusData = migrationStatusAppSpace(parseMigrationStatusJson(status));
        const pending = statusData.migrations.filter((m) => m.status === 'pending').length;
        expect(pending, '7: 0 pending').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
