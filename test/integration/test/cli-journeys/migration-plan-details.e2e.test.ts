/**
 * Migration Plan Details (Journeys H + I)
 *
 * H — Plan JSON envelope and attestation: plan an initial migration with
 *     --json, verify the envelope contains operations, from/to hashes,
 *     and dir. Then verify the planned migration passes attestation and
 *     the on-disk chain linkage is correct.
 *
 * I — Destructive planning: plan an initial migration, swap to a contract
 *     that removes a column, plan the drop-column migration, and verify the
 *     JSON output and on-disk migration contain destructive operation class.
 */

import { join } from 'node:path';
import { readMigrationPackage, readMigrationsDir } from '@prisma/orm-postgres/migration-tools/io';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  swapContract,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey H: Plan JSON Envelope and Attestation
  // -------------------------------------------------------------------------
  describe('Journey H: Plan JSON Envelope and Attestation', () => {
    const db = useDevDatabase();

    it(
      'emit → plan --json (verify envelope) → verify attestation → check chain linkage',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // H.01: contract emit
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'H.01: contract emit').toBe(0);

        // H.02: migration plan --json (plan+self-emit so the migration is
        // attested on disk for H.03's verifyMigration check).
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'initial', '--json']);
        expect(plan.exitCode, 'H.02: migration plan --json').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          noOp: boolean;
          // Mirrors `MigrationPlanResult.from` (`string | null`); `null` is the
          // baseline encoding produced by `migration plan` for an empty
          // origin contract.
          from: string | null;
          to: string;
          dir: string;
          operations: readonly { id: string; label: string; operationClass: string }[];
        }>(plan);

        expect(result.ok, 'H.02: ok flag').toBe(true);
        expect(result.noOp, 'H.02: not a noop').toBe(false);
        expect(result.from, 'H.02: from is null (baseline)').toBeNull();
        expect(result.to, 'H.02: to is defined').toBeDefined();
        expect(result.dir, 'H.02: dir is defined').toBeDefined();
        expect(result.operations.length, 'H.02: has operations').toBeGreaterThan(0);

        const tableOp = result.operations.find((op) => op.id.includes('user'));
        expect(tableOp, 'H.02: has user table operation').toBeDefined();

        // H.03: verify attestation on disk
        const migrationsRoot = join(ctx.testDir, 'migrations');
        const appSpaceDir = join(migrationsRoot, 'app');
        const { packages } = await readMigrationsDir(appSpaceDir, {
          migrationsDir: migrationsRoot,
        });
        expect(packages, 'H.03: one migration package').toHaveLength(1);

        // `readMigrationPackage`'s load boundary integrates verification:
        // a successful read is proof of attestation, and any tamper throws
        // MIGRATION.HASH_MISMATCH.
        const pkgDir = join(appSpaceDir, packages[0]!.dirName);
        await expect(
          readMigrationPackage(pkgDir, { migrationsDir: migrationsRoot }),
          'H.03: attestation passes',
        ).resolves.toBeDefined();

        // H.04: chain linkage
        expect(packages[0]!.metadata.from, 'H.04: from is null (baseline)').toBeNull();
        expect(packages[0]!.metadata.to, 'H.04: to matches plan output').toBe(result.to);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey I: Destructive Planning (Drop Column)
  // -------------------------------------------------------------------------
  describe('Journey I: Destructive Planning', () => {
    const db = useDevDatabase();

    it(
      'emit → plan initial → swap destructive → plan drop-column → verify destructive ops',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // I.01: emit base contract and plan initial migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'I.01: contract emit').toBe(0);
        // Self-emit the initial migration so it's attested and becomes a
        // leaf in the migration graph — otherwise I.03's planner computes
        // from the empty contract and mis-classifies the change.
        const planInit = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'I.01: plan initial').toBe(0);

        // I.02: swap to destructive contract (removes email column)
        swapContract(ctx, 'contract-destructive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'I.02: contract emit destructive').toBe(0);

        // I.03: plan drop-column migration
        const planDrop = await runMigrationPlan(ctx, [
          '--name',
          'drop-email',
          '--from',
          latestMigrationDirName(ctx),
          '--delete',
          'User.email',
          '--json',
        ]);
        expect(planDrop.exitCode, 'I.03: plan drop-email').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          noOp: boolean;
          operations: readonly { id: string; label: string; operationClass: string }[];
        }>(planDrop);

        expect(result.ok, 'I.03: ok flag').toBe(true);
        expect(result.noOp, 'I.03: not a noop').toBe(false);

        const dropOp = result.operations.find(
          (op) => op.id.includes('email') || op.label.toLowerCase().includes('email'),
        );
        expect(dropOp, 'I.03: has email-related operation').toBeDefined();
        expect(dropOp!.operationClass, 'I.03: email op is destructive').toBe('destructive');

        // Self-emit the drop-email migration so `ops.json` lands on disk for
        // the I.04 assertion below. `migration plan` no longer auto-emits
        // (see ADR on placeholder stubs / user self-emit); the test has to
        // run the scaffolded `migration.ts` explicitly to produce ops.json.
        const dropDir = getLatestMigrationDir(ctx);
        expect(dropDir, 'I.03: drop-email migration dir').toBeTruthy();
        const dropEmitResult = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dropDir}`]);
        expect(dropEmitResult.exitCode, `I.03: emit drop-email: ${dropEmitResult.stderr}`).toBe(0);

        // I.04: verify destructive operation class on disk
        const migrationsRoot = join(ctx.testDir, 'migrations');
        const { packages } = await readMigrationsDir(join(migrationsRoot, 'app'), {
          migrationsDir: migrationsRoot,
        });
        expect(packages, 'I.04: two migration packages').toHaveLength(2);

        const destructivePkg = packages.find((p) => p.metadata.from !== null)!;
        const destructiveOps = destructivePkg.ops.filter(
          (op) => op.operationClass === 'destructive',
        );
        expect(destructiveOps.length, 'I.04: has destructive ops on disk').toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
