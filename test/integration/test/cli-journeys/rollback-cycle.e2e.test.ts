/**
 * Rollback Cycle (Journey J — spec scenario P-2/S-2)
 *
 * Tests cycle-safe shortest-path resolution after a rollback migration
 * creates a cycle in the migration graph (C1 → C2 → C1). The rollback is
 * the one-command flow: `--to <dir>^` with no contract-source
 * edit. Every plan names its base explicitly (`--from <dir|hash>`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
  runMigrationStatus,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey J: Rollback Cycle (P-2/S-2)', () => {
    const db = useDevDatabase();

    it(
      'C1 → C2 → C1 rollback creates cycle → plan with --from recovers',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // J.01: emit base contract (C1) → plan + apply init
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'J.01: emit C1').toBe(0);
        const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'J.01: plan init').toBe(0);
        const planResult0 = parseJsonOutput<{ to: string }>(plan0);
        const c1Hash = planResult0.to;
        const apply0 = await runMigrate(ctx);
        expect(apply0.exitCode, 'J.01: apply init').toBe(0);

        // J.02: swap to contract-phone (C2) → emit → plan + apply add-phone
        swapContract(ctx, 'contract-phone');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'J.02: emit C2').toBe(0);
        const plan1 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-phone',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan1.exitCode, 'J.02: plan add-phone').toBe(0);
        const planResult1 = parseJsonOutput<{ to: string }>(plan1);
        const c2Hash = planResult1.to;
        expect(c2Hash, 'J.02: C2 differs from C1').not.toBe(c1Hash);
        const apply1 = await runMigrate(ctx);
        expect(apply1.exitCode, 'J.02: apply add-phone').toBe(0);

        // One-command rollback (folded in from the deleted plan-to-rollback
        // journey): plan toward the add-phone migration's
        // predecessor via `--to <dir>^` — no contract-source edit. The
        // reverse delta drops the added column, so applying needs `-y`.
        const addPhoneDir = latestMigrationDirName(ctx);
        const rollbackTarget = `${addPhoneDir}^`;
        const planRollback = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'rollback-phone',
          '--from',
          addPhoneDir,
          '--to',
          rollbackTarget,
          '--delete',
          'User.phone',
          '--json',
        ]);
        expect(planRollback.exitCode, 'plan rollback --to <dir>^').toBe(0);
        const rollback = parseJsonOutput<{
          from: string;
          to: string;
          operations: readonly { operationClass: string }[];
        }>(planRollback);
        expect(rollback.from, 'rollback from C2').toBe(c2Hash);
        expect(rollback.to, 'rollback to predecessor C1').toBe(c1Hash);
        expect(
          rollback.operations.some((op) => op.operationClass === 'destructive'),
          'reverse delta drops the added column (destructive), answered by --delete',
        ).toBe(true);
        const contractSource = readFileSync(join(ctx.testDir, 'contract.ts'), 'utf-8');
        expect(contractSource, 'contract source untouched (still phone variant)').toContain(
          'phone',
        );
        const apply2 = await runMigrate(ctx, ['--to', rollbackTarget, '-y', '--json']);
        expect(apply2.exitCode, 'apply rollback').toBe(0);
        const applied2 = parseJsonOutput<{ ok: boolean; markerHash: string }>(apply2);
        expect(applied2.ok, 'rollback applied ok').toBe(true);
        expect(applied2.markerHash, 'marker moved back to C1').toBe(c1Hash);

        // Graph has cycle (C1→C2→C1); planning from the rollback tip
        // (named explicitly — with no db ref, an unflagged plan would be
        // greenfield) still plans forward out of the cycle.
        swapContract(ctx, 'contract-bio');
        const emit3 = await runContractEmit(ctx);
        expect(emit3.exitCode, 'emit C3 (bio)').toBe(0);
        const planImplicit = await runMigrationPlan(ctx, [
          '--name',
          'add-bio-implicit',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(planImplicit.exitCode, 'plan from the rollback tip').toBe(0);
        const implicitResult = parseJsonOutput<{ from: string; to: string }>(planImplicit);
        expect(implicitResult.from, 'plan base resolved').toBeTruthy();

        // J.05: plan with --from C1 recovers
        const planFrom = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-bio',
          '--from',
          c1Hash,
          '--json',
        ]);
        expect(planFrom.exitCode, 'J.05: plan --from C1').toBe(0);
        const planFromResult = parseJsonOutput<{ from: string; to: string; noOp: boolean }>(
          planFrom,
        );
        expect(planFromResult.noOp, 'J.05: not a noop').toBe(false);
        expect(planFromResult.from, 'J.05: from is C1').toBe(c1Hash);

        // J.06: apply and verify status
        const apply3 = await runMigrate(ctx, ['--json']);
        expect(apply3.exitCode, 'J.06: apply add-bio').toBe(0);
        const applyResult = parseJsonOutput<{ ok: boolean; migrationsApplied: number }>(apply3);
        expect(applyResult.ok, 'J.06: ok').toBe(true);
        expect(applyResult.migrationsApplied, 'J.06: applied 1').toBe(1);

        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, 'J.06: status').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
