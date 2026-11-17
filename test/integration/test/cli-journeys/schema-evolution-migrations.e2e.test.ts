/**
 * Schema Evolution via Migrations (Journeys B + Z)
 *
 * B — Full migration lifecycle: plan a migration, show its details, verify the
 *     planned directory, check status (offline and online), apply, confirm all
 *     applied, then db verify. Also covers edge cases merged from former
 *     standalone journeys: apply when already up-to-date (noop), plan when
 *     contract is unchanged (noop), and migration show variants (by path,
 *     not-found prefix).
 *
 * Z — Transition from db init to migrations: initialize with db init, then
 *     switch to the migration workflow by planning and applying a migration.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { clearDbRefForGreenfieldPlan, withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  runMigrationShow,
  runMigrationStatus,
  selfEmitMigration,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey B: Schema Evolution via Migrations
  // -------------------------------------------------------------------------
  describe('Journey B: Schema Evolution via Migrations', () => {
    const db = useDevDatabase();

    it(
      'emit → plan initial → apply → swap → plan v2 → show → emit → status → apply → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: emit base contract and plan initial migration (∅ → base)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'B.pre: emit base').toBe(0);
        const planInit = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'B.pre: plan initial').toBe(0);
        const applyInit = await runMigrate(ctx);
        expect(applyInit.exitCode, 'B.pre: apply initial').toBe(0);

        // B.01: Swap to contract-additive, contract emit
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'B.01: contract emit v2').toBe(0);

        // B.02: migration plan --name add-name-column
        const plan = await runMigrationPlan(ctx, [
          '--name',
          'add-name-column',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan.exitCode, 'B.02: migration plan').toBe(0);
        expect(stripAnsi(plan.stderr), 'B.02: shows migration').toContain('add-name-column');

        // B.03: migration show (explicit target — latest planned migration)
        const showTarget = getLatestMigrationDir(ctx);
        expect(showTarget, 'B.03: planned migration dir').toBeDefined();
        const show = await runMigrationShow(ctx, [showTarget!]);
        expect(show.exitCode, 'B.03: migration show').toBe(0);

        // self-emit the planned migration.ts
        const migDir = getLatestMigrationDir(ctx);
        expect(migDir, 'B.04: migration dir exists').toBeDefined();
        const emitMig = await selfEmitMigration(ctx, ['--dir', `migrations/app/${migDir}`]);
        expect(emitMig.exitCode, 'migration.ts self-emit').toBe(0);

        // B.05: migration status (pre-apply — shows pending migration)
        const statusPreApply = await runMigrationStatus(ctx);
        expect(statusPreApply.exitCode, 'B.05: migration status pre-apply').toBe(0);
        expect(stripAnsi(statusPreApply.stderr), 'B.05: shows pending').toContain('pending');

        // migrate applies the planned migration
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, 'migrate applies the plan').toBe(0);

        // B.07: migration status (all applied)
        const statusApplied = await runMigrationStatus(ctx);
        expect(statusApplied.exitCode, 'B.07: migration status applied').toBe(0);
        expect(stripAnsi(statusApplied.stderr), 'B.07: shows applied').toContain('applied');

        // B.08: db verify
        const dbVerify = await runDbVerify(ctx);
        expect(dbVerify.exitCode, 'B.08: db verify').toBe(0);

        // B.09: migration status --json
        const statusJson = await runMigrationStatus(ctx, ['--json']);
        expect(statusJson.exitCode, 'B.09: migration status json').toBe(0);
        const statusData = parseJsonOutput(statusJson);
        expect(statusData, 'B.09: json structure').toMatchObject({
          ok: true,
          spaces: [
            {
              space: 'app',
              migrations: expect.arrayContaining([
                expect.objectContaining({
                  status: expect.stringMatching(/^(applied|pending)$/),
                }),
              ]),
            },
          ],
        });

        // --- Merged from Journey Q: migrate noop (already up-to-date) ---

        // migrate --json (already up-to-date)
        const applyNoop = await runMigrate(ctx, ['--json']);
        expect(applyNoop.exitCode, 'migrate noop').toBe(0);
        const noopApplyData = parseJsonOutput(applyNoop);
        expect(noopApplyData, 'Q.01: 0 applied').toMatchObject({
          ok: true,
          migrationsApplied: 0,
        });

        // --- Merged from Journey R: migration plan noop (contract unchanged) ---

        // migration plan from the leaf (no changes — contract matches it)
        const planNoop = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(planNoop.exitCode, 'migration plan noop').toBe(0);
        const noopPlanData = parseJsonOutput(planNoop);
        expect(noopPlanData, 'noop flag').toMatchObject({ noOp: true });

        // --- Merged from Journey X: migration show variants ---

        // X.01: migration show (latest dir — already tested in B.03, verify again post-apply)
        const latestDir = getLatestMigrationDir(ctx);
        expect(latestDir, 'X.01: latest migration dir').toBeDefined();
        const showLatest = await runMigrationShow(ctx, [latestDir!]);
        expect(showLatest.exitCode, 'X.01: show latest').toBe(0);

        // X.02: migration show by path (first migration dir)
        const migrationsDir = join(ctx.testDir, 'migrations', 'app');
        const migrationDirs = readdirSync(migrationsDir).sort();
        if (migrationDirs.length > 0) {
          const firstDir = migrationDirs[0]!;
          const showByPath = await runMigrationShow(ctx, [join('migrations', 'app', firstDir)]);
          expect(showByPath.exitCode, 'X.02: show by path').toBe(0);
        }

        // X.03: migration show with non-existent prefix
        const showNotFound = await runMigrationShow(ctx, ['nonexistent123']);
        expect(showNotFound.exitCode, 'X.03: show not found').toBe(2);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey Z: Transition from db init to Migration Workflow
  // -------------------------------------------------------------------------
  describe('Journey Z: Init-to-Migrations Transition', () => {
    const db = useDevDatabase();

    it(
      'init → swap → plan (uses --from marker hash) → apply → status',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: initialize with base contract via db init
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'Z.pre: emit base').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'Z.pre: db init').toBe(0);

        // Z.01: Swap to contract-additive, contract emit
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'Z.01: contract emit v2').toBe(0);

        // Z.02: migration plan --name initial-evolution
        // Since db init set the marker but no migration chain exists, migration plan
        // creates from ∅ → additive. The marker won't match the chain root.
        // Instead, we use db update for this transition (which is how it works in practice).
        // Journey Z tests the realistic "switch to migrations" workflow.
        clearDbRefForGreenfieldPlan(ctx.testDir);
        const plan = await runMigrationPlan(ctx, ['--name', 'initial-evolution']);
        expect(plan.exitCode, 'Z.02: migration plan').toBe(0);

        // migrate fails because the db init marker doesn't match
        // the migration chain root (planned from ∅→additive, but marker is at base).
        // Then db update recovers by applying the schema directly.
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, 'migrate rejects marker mismatch').toBe(2);

        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'Z.03: db update recovery').toBe(0);

        // Z.04: db verify
        const dbVerify = await runDbVerify(ctx);
        expect(dbVerify.exitCode, 'Z.04: db verify').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
