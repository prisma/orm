/**
 * Migration DAG Drift — Chain Breakage (Journey P3)
 *
 * After building a migration chain (initial → add-name → add-posts), the
 * add-posts directory is deleted from disk. migration status reports the
 * broken chain, migrate fails (no path to destination), and recovery
 * is achieved by re-planning the missing edge and applying it.
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
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
  // -------------------------------------------------------------------------
  // Journey P3: Migration Chain Breakage
  // -------------------------------------------------------------------------
  describe('Journey P3: Chain Breakage', () => {
    const db = useDevDatabase();

    it(
      'plan → apply → plan v2 → delete dir → apply fails → re-plan → apply',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: emit base, plan+apply initial, then plan and apply first migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'P3.pre: emit base').toBe(0);
        const planInit = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'P3.pre: plan initial').toBe(0);
        const applyInit = await runMigrate(ctx);
        expect(applyInit.exitCode, 'P3.pre: apply initial').toBe(0);

        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'P3.pre: emit v2').toBe(0);
        const plan1 = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-name',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan1.exitCode, 'P3.pre: plan v2').toBe(0);
        const apply1 = await runMigrate(ctx);
        expect(apply1.exitCode, 'P3.pre: apply v2').toBe(0);

        // Plan a second migration
        swapContract(ctx, 'contract-v3');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'P3.pre: emit v3').toBe(0);
        const plan2 = await runMigrationPlan(ctx, [
          '--name',
          'add-posts',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan2.exitCode, 'P3.pre: plan v3').toBe(0);

        // Delete the add-posts migration directory (additive→v3 edge)
        // Note: can't use alphabetical sort — 'initial' sorts after 'add-*'.
        // Find by name suffix instead.
        const migrationsDir = join(ctx.testDir, 'migrations', 'app');
        const migrationDirs = readdirSync(migrationsDir);
        const addPostsDir = migrationDirs.find((d) => d.endsWith('_add_posts'));
        expect(addPostsDir, 'P3.pre: add-posts dir exists').toBeDefined();
        rmSync(join(migrationsDir, addPostsDir!), { recursive: true, force: true });

        // migration status reports the broken chain (contract has no
        // matching leaf) and still lists the surviving on-disk migrations
        // rather than treating the space as empty (folded in from the
        // deleted drift-deleted-root journey).
        const statusBroken = await runMigrationStatus(ctx);
        expect([0, 1], 'status exits 0 or 1').toContain(statusBroken.exitCode);
        expect(statusBroken.stderr, 'surviving migrations visible').toMatch(/add_name/);
        expect(statusBroken.stderr, 'not treated as empty').not.toContain('No migrations found');

        // migrate fails — no path from marker to destination contract
        const applyFail = await runMigrate(ctx);
        expect(applyFail.exitCode, 'migrate fails on the broken chain').not.toBe(0);

        // P3.03: re-plan the missing edge (chain leaf is additive, contract is v3)
        const rePlan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          're-add-posts',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(rePlan.exitCode, 'P3.03: migration plan recovery').toBe(0);

        // The recovery plan adds exactly the missing edge — it must not
        // greenfield-plan a duplicate init (folded in from the deleted
        // drift-deleted-root journey).
        const dirsAfterRePlan = readdirSync(migrationsDir).filter(
          (d) => !d.startsWith('.') && d !== 'refs',
        );
        expect(
          dirsAfterRePlan.filter((d) => d.endsWith('_initial')),
          'exactly one init migration',
        ).toHaveLength(1);

        // migrate applies the re-planned additive→v3 migration
        const applyRecovery = await runMigrate(ctx);
        expect(applyRecovery.exitCode, 'migrate applies the recovery plan').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
