/**
 * Migration Status Diagnostics
 *
 * Tests the summary line, diagnostic messages, and hints produced by
 * `migration status` across distinct user scenarios. Each test sets up
 * real state (contract, migrations on disk, DB marker) and asserts on
 * the textual output — not implementation internals.
 *
 * Why journey tests? `migration status` synthesizes information from three
 * independent sources (contract on disk, migration graph on disk, DB marker)
 * and must produce actionable guidance for each combination. Unit tests
 * cover the individual functions; these tests verify the *user-visible*
 * output for realistic scenarios end-to-end.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  EMPTY_CONTRACT_HASH,
  type JourneyContext,
  latestMigrationDirName,
  migrationStatusAppSpace,
  parseJsonOutput,
  parseMigrationStatusJson,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationStatus,
  runRef,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('migration status diagnostics', () => {
    // -----------------------------------------------------------------------
    // Offline scenarios (no database)
    // -----------------------------------------------------------------------

    /**
     * Scenario: brand-new project, nothing set up yet.
     *
     * The user hasn't emitted a contract or planned any migrations.
     * Status should report the empty state without errors — this is the
     * starting point, not an error condition.
     *
     * Then: user emits a contract but hasn't run `migration plan` yet.
     * The contract exists on disk so we know what the schema *should*
     * look like, but no migration has been planned. The user needs to
     * be told to run `migration plan`.
     *
     * Then: migrations have been planned but there's no database
     * connection (offline mode). The user should see the migration
     * graph and a count of migrations on disk, with no status
     * indicators (applied/pending/unreachable can't be determined
     * without a DB).
     */
    it(
      'offline scenarios: empty → contract only → migrations on disk',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const statusWithoutDb = await runMigrationStatus(ctx);
        expect(statusWithoutDb.exitCode, 'requires --db or --from').not.toBe(0);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit succeeds').toBe(0);

        const statusContractOnly = await runMigrationStatus(ctx);
        expect(statusContractOnly.exitCode, 'still requires --db or --from after emit').not.toBe(0);

        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
        expect(plan.exitCode, 'plan').toBe(0);
        const planFrom = parseJsonOutput<{ from: string | null }>(plan).from;

        const statusMigrations = await runMigrationStatus(ctx, [
          '--from',
          planFrom ?? EMPTY_CONTRACT_HASH,
        ]);
        const outMigrations = stripAnsi(statusMigrations.stderr);
        expect(statusMigrations.exitCode).toBe(0);
        expect(outMigrations).toContain('pending');
        expect(outMigrations).not.toContain('✓ applied');
      },
      timeouts.spinUpPpgDev,
    );

    // -----------------------------------------------------------------------
    // Online scenarios — each gets its own database to avoid cross-test
    // contamination (schema/marker from one test leaking into the next).
    // -----------------------------------------------------------------------

    /**
     * Scenario: migrations exist on disk but the database has never been
     * initialized (no marker row in prisma_contract.marker).
     *
     * This happens when a developer clones a repo with existing migrations
     * and connects to a fresh database. The key signal is the missing
     * marker — the user needs to run `migrate` to bring the DB
     * up to date.
     */
    describe('fresh DB, migrations exist — MIGRATION.NO_MARKER', () => {
      const db = useDevDatabase();

      it(
        'emit → plan (no apply) → status warns about missing marker',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toMatch(/pending/);
          expect(out).toContain('{bin} db migrate');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the happy path — all planned migrations have been applied.
     *
     * The DB marker matches the graph's target node. There is nothing to do.
     * Status should confirm this clearly so the user knows they're safe.
     */
    describe('all applied — up to date', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → status reports up to date',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);
          const apply = await runMigrate(ctx);
          expect(apply.exitCode, 'apply').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('Up to date');
          expect(out).toContain('applied');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the DB is behind — some migrations haven't been applied yet.
     *
     * This is the standard deployment scenario: a new migration was planned
     * (e.g. by a teammate) but hasn't been applied to this database. The
     * user needs to know how many migrations are pending and be told to
     * run `migrate`.
     */
    describe('some pending — DATABASE_BEHIND', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit → plan → status shows pending',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const plan1 = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'add-field',
            '--from',
            latestMigrationDirName(ctx),
          ]);
          expect(plan1.exitCode, 'plan v2').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toMatch(/1 pending/);
          expect(out).toContain('{bin} db migrate');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the contract has been changed since the last migration was
     * planned — the contract hash doesn't appear anywhere in the graph.
     *
     * This typically means the developer edited their schema but forgot to
     * run `migration plan`. The DB is still on the last applied migration;
     * status targets the live contract and reports no migration path to it.
     */
    describe('fresh DB, live contract unreachable from empty — no-path summary', () => {
      const db = useDevDatabase();

      it(
        'emit → plan (no apply) → swap → emit → no path from empty database state',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('No migration path from the database state');
          expect(out).toContain("to the application's contract");
          expect(out).not.toContain('up to date');
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract changed since last plan — CONTRACT.AHEAD', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit (no plan) → no path to live contract',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('@contract');
          expect(out).toContain("to the application's contract");
          expect(out).toContain('{bin} migration plan --name');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the database was updated directly via `db update` instead
     * of through the migration system.
     *
     * The DB marker matches the live contract after db update, but that
     * hash may not be a migration-graph node. Status defaults to the live
     * contract as target (same as migrate); when DB and contract align,
     * the headline is up to date while MARKER_NOT_IN_HISTORY still warns.
     */
    describe('DB updated directly — marker ahead of graph', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → emit → db update → up to date with divergence warn',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const update = await runDbUpdate(ctx);
          expect(update.exitCode, 'db update').toBe(0);

          const status = await runMigrationStatus(ctx);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('@contract @db (db)');
          expect(out).toContain('Up to date');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: the DB marker doesn't match any node in the migration
     * graph AND doesn't match the current contract. The database is at
     * an unknown state relative to both the migrations and the contract.
     *
     * This happens when someone ran `db update` or `db sign` to a
     * contract state, then changed the contract again (so marker ≠
     * contract) and there's no migration matching the marker either.
     * The command can't render meaningful applied/pending statuses, so
     * it bails out early with recovery hints: sign, update, infer, or
     * verify. This is the most disoriented state a user can be in.
     */
    describe('marker off-graph, mismatches contract — bail-out with recovery hints', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → swap → db update → swap again → emit → status bails out',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          // Base: emit → plan → apply
          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan0.exitCode, 'plan').toBe(0);
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply').toBe(0);

          // Push marker off-graph via db update to contract-additive
          swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit v2').toBe(0);
          const update = await runDbUpdate(ctx);
          expect(update.exitCode, 'db update').toBe(0);

          // Now swap to a *third* contract so marker ≠ contract
          swapContract(ctx, 'contract-phone');
          const emit2 = await runContractEmit(ctx);
          expect(emit2.exitCode, 'emit v3').toBe(0);

          const status = await runMigrationStatus(ctx, ['--json']);

          expect(status.exitCode).toBe(0);
          const statusJson = parseMigrationStatusJson(status);
          expect(statusJson.summary).toContain('not in the on-disk migration graph');
          const hints =
            statusJson.diagnostics?.flatMap((diagnostic) => [
              diagnostic.message,
              ...(diagnostic.hints ?? []),
            ]) ?? [];
          expect(hints.join('\n')).toMatch(/db sign/i);
          expect(hints.join('\n')).toMatch(/db update/i);
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: happy path, verified through `--json` output.
     *
     * The JSON envelope is the primary interface for agents and
     * programmatic consumers. Internal fields (graph, bundles,
     * edgeStatuses, activeRefHash, activeRefName, diverged) must be
     * stripped — they're implementation details that would create a
     * brittle public API. The JSON should contain only the fields a
     * consumer needs to decide what to do next.
     */
    describe('JSON output shape — strips internal fields', () => {
      const db = useDevDatabase();

      it(
        'emit → plan → apply → status --json contains public fields only',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, 'emit').toBe(0);
          const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
          expect(plan.exitCode, 'plan').toBe(0);
          const apply = await runMigrate(ctx);
          expect(apply.exitCode, 'apply').toBe(0);

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode).toBe(0);
          const json = parseMigrationStatusJson(status);
          const appSpace = migrationStatusAppSpace(json);

          expect(json.ok).toBe(true);
          expect(json.summary).toBeTruthy();
          expect(appSpace.space).toBe('app');
          expect(appSpace.targetContract).toBeTruthy();
          expect(appSpace.migrations.length).toBeGreaterThan(0);
          expect(appSpace.migrations[0]?.status).toBe('applied');

          expect(json).not.toHaveProperty('graph');
          expect(json).not.toHaveProperty('bundles');
          expect(json).not.toHaveProperty('treeSections');
          expect(json).not.toHaveProperty('mode');
          expect(json).not.toHaveProperty('contractHash');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: two teammates branched migrations from the same point,
     * creating a diamond/fork in the graph, and no ref has been set.
     *
     * The migration graph has two reachable leaves from the marker but
     * the live contract is a third variant (not on either branch). Status
     * defaults to the live contract as target and reports no path from the
     * database state to that contract.
     */
    describe('divergent graph — live contract off branches', () => {
      const db = useDevDatabase();

      it(
        'two branches from same base → no path to live contract',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const baseHash = parseJsonOutput<{ to: string }>(plan0).to;
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          swapContract(ctx, 'contract-phone');
          const emitA = await runContractEmit(ctx);
          expect(emitA.exitCode, 'emit branch A').toBe(0);
          const planA = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'add-phone',
            '--from',
            baseHash,
          ]);
          expect(planA.exitCode, 'plan branch A').toBe(0);

          swapContract(ctx, 'contract-bio');
          const emitB = await runContractEmit(ctx);
          expect(emitB.exitCode, 'emit branch B').toBe(0);
          const planB = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'add-bio',
            '--from',
            baseHash,
          ]);
          expect(planB.exitCode, 'plan branch B').toBe(0);

          // Swap to a contract that doesn't match either leaf so the
          // status command can't auto-resolve to one branch.
          swapContract(ctx, 'contract-additive');
          const emitC = await runContractEmit(ctx);
          expect(emitC.exitCode, 'emit neutral').toBe(0);

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode).toBe(0);
          const json = parseMigrationStatusJson(status);
          expect(json.summary).toContain("to the application's contract");
          expect(json.summary).toContain('{bin} migration plan --name');
        },
        timeouts.spinUpPpgDev,
      );
    });

    /**
     * Scenario: DB marker is on branch A, but the ref points at branch B.
     * There is no path between them — the DB went down a different fork
     * than the one the ref targets.
     *
     * This happens when a developer applied one teammate's migration
     * locally but the team's ref points at a different branch. The user
     * needs to know that their DB and the ref have diverged — there's no
     * sequence of applies that will get them from where they are to where
     * the ref says they should be.
     */
    describe('marker on wrong branch — no path to ref', () => {
      const db = useDevDatabase();

      it(
        'apply branch A, ref points at branch B → no path between marker and ref',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit base').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan init').toBe(0);
          const baseHash = parseJsonOutput<{ to: string }>(plan0).to;
          const apply0 = await runMigrate(ctx);
          expect(apply0.exitCode, 'apply init').toBe(0);

          // Branch A: plan + apply
          swapContract(ctx, 'contract-phone');
          const emitA = await runContractEmit(ctx);
          expect(emitA.exitCode, 'emit A').toBe(0);
          const planA = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'add-phone',
            '--from',
            baseHash,
          ]);
          expect(planA.exitCode, 'plan A').toBe(0);
          const applyA = await runMigrate(ctx);
          expect(applyA.exitCode, 'apply A').toBe(0);

          // Branch B: plan (don't apply) + set ref to B's target
          swapContract(ctx, 'contract-bio');
          const emitB = await runContractEmit(ctx);
          expect(emitB.exitCode, 'emit B').toBe(0);
          const planB = await planMigrationAndSelfEmit(ctx, [
            '--name',
            'add-bio',
            '--from',
            baseHash,
            '--json',
          ]);
          expect(planB.exitCode, 'plan B').toBe(0);
          const hashB = parseJsonOutput<{ to: string }>(planB).to;

          const setRef = await runRef(ctx, ['set', 'production', hashB]);
          expect(setRef.exitCode, 'ref set').toBe(0);

          const status = await runMigrationStatus(ctx, ['--to', 'production']);
          const out = stripAnsi(status.stderr);

          expect(status.exitCode).toBe(0);
          expect(out).toContain('No migration path from the database state');
          expect(out).toContain('via `production`');
          expect(out).toContain('{bin} migration plan');
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('--from constrains the path origin', () => {
      const db = useDevDatabase();

      it(
        'emit → plan twice → status --from <hash> computes path from that contract',
        async () => {
          const ctx: JourneyContext = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
          });

          const emit0 = await runContractEmit(ctx);
          expect(emit0.exitCode, 'emit0').toBe(0);
          const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
          expect(plan0.exitCode, 'plan0').toBe(0);

          await swapContract(ctx, 'contract-additive');
          const emit1 = await runContractEmit(ctx);
          expect(emit1.exitCode, 'emit1').toBe(0);
          const plan1 = await planMigrationAndSelfEmit(ctx, ['--name', 'additive']);
          expect(plan1.exitCode, 'plan1').toBe(0);

          const hashA = parseJsonOutput(plan0)?.['to'] as string;
          expect(hashA, 'plan0 must produce a target hash').toBeTruthy();

          const status = await runMigrationStatus(ctx, ['--from', hashA, '--json']);
          expect(status.exitCode).toBe(0);
          const json = parseMigrationStatusJson(status);
          expect(migrationStatusAppSpace(json).migrations.length).toBeGreaterThan(0);
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
