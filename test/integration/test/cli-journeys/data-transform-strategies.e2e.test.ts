/**
 * Planner-assisted dataTransform strategies, end-to-end — one scenario per
 * Postgres planner call strategy (plan.md AC R2.2):
 *
 * - `notNullBackfillCallStrategy` (#1): an existing table gains a NOT NULL
 *   column with no default. The planner emits `addColumn(nullable) →
 *   DataTransformCall(placeholder slots) → setNotNull`.
 * - `nullableTighteningCallStrategy` (#3): an existing column flips from
 *   nullable to NOT NULL (no addColumn, no type change). The planner emits
 *   `DataTransformCall(placeholder slots) → setNotNull`.
 * - `typeChangeCallStrategy` (#2): a column's type changes (text → int4).
 *   The planner emits `DataTransformCall(placeholder slots) →
 *   alterColumnType`.
 *
 * Each scenario simulates the user editing the planner-emitted
 * `migration.ts` (string-patching the placeholder stubs and injecting a
 * `db = sql(...)` setup), re-emits the package in-process, applies it, and
 * asserts the post-apply data and column shape.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  injectMigrationSqlDbSetup,
  type JourneyContext,
  latestMigrationDirName,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BACKFILLED_NAME = 'unknown';

type ContractVariant = Parameters<typeof swapContract>[1];

interface Scenario {
  readonly strategy: string;
  readonly title: string;
  /** Contract to swap to (and apply) before seeding; absent = the base contract. */
  readonly initialContract: ContractVariant | undefined;
  readonly seedSql: string;
  readonly targetContract: ContractVariant;
  readonly migrationName: string;
  /** The statements the plan needs, such as consent to a type change that can lose values. */
  readonly statements?: readonly string[];
  readonly dirToken: string;
  readonly placeholderId: string;
  readonly assertScaffold: (scaffold: string) => void;
  readonly checkReplacement: string;
  readonly runReplacement: string;
  readonly assertOps: (ops: readonly { id: string; operationClass?: string }[]) => void;
  readonly postApplySelect: string;
  readonly expectedRows: readonly Record<string, unknown>[];
  readonly columnInfoSql: string;
  readonly expectedColumnInfo: readonly Record<string, unknown>[];
  /** The backfill scenario also pins the re-apply no-op path (spec AC4.2). */
  readonly assertReapplyNoop: boolean;
}

const scenarios: readonly Scenario[] = [
  {
    strategy: 'notNullBackfillCallStrategy',
    title: 'NOT NULL backfill: planner emits placeholder() stubs; apply backfills + sets NOT NULL',
    initialContract: undefined,
    seedSql: `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@test.org')`,
    targetContract: 'contract-additive-required-name',
    migrationName: 'add-required-name',
    dirToken: 'add_required_name',
    placeholderId: 'backfill-user-name',
    assertScaffold: () => {},
    checkReplacement:
      "() => db.public.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)",
    runReplacement: `() => db.public.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null))`,
    assertOps: () => {},
    postApplySelect: `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
    expectedRows: [
      { id: 1, email: 'alice@example.com', name: BACKFILLED_NAME },
      { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
    ],
    columnInfoSql: `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'name'`,
    expectedColumnInfo: [{ is_nullable: 'NO' }],
    assertReapplyNoop: true,
  },
  {
    strategy: 'nullableTighteningCallStrategy',
    title:
      'nullable → NOT NULL tightening: planner emits placeholder() stubs; apply backfills NULLs + tightens',
    initialContract: 'contract-nullable-name',
    seedSql: `INSERT INTO "public"."user" (id, email, "name") VALUES (1, 'alice@example.com', 'Alice'), (2, 'bob@test.org', NULL)`,
    targetContract: 'contract-nullable-name-required',
    migrationName: 'tighten-name-not-null',
    dirToken: 'tighten_name_not_null',
    placeholderId: 'handle-nulls-user-name',
    assertScaffold: (scaffold) => {
      expect(scaffold).toContain('setNotNull');
      // The planner *must not* emit an addColumn here: this is the
      // tightening case, the column already exists.
      expect(scaffold).not.toContain('addColumn');
    },
    checkReplacement:
      "() => db.public.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)",
    runReplacement: `() => db.public.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null))`,
    assertOps: (ops) => {
      const setNotNullOp = ops.find((op) => op.id.includes('setNotNull.user.name'));
      expect(setNotNullOp, 'setNotNull op exists').toBeDefined();
    },
    postApplySelect: `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
    expectedRows: [
      { id: 1, email: 'alice@example.com', name: 'Alice' },
      { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
    ],
    columnInfoSql: `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'name'`,
    expectedColumnInfo: [{ is_nullable: 'NO' }],
    assertReapplyNoop: false,
  },
  {
    strategy: 'typeChangeCallStrategy',
    title: 'text → int4 type change: planner emits placeholder() stubs; apply alters column type',
    // The user-filled queries here are intentionally no-ops (guarded by
    // `id = -1`): the goal is the dataTransform → alterColumnType pipeline
    // end-to-end, with the `USING score::int4` cast doing the conversion.
    // A real "score is not castable" check against a text column through
    // the int4-typed ORM surface isn't currently expressible without an
    // escape hatch.
    initialContract: 'contract-typechange-text',
    seedSql: `INSERT INTO "public"."user" (id, email, score) VALUES (1, 'alice@example.com', '10'), (2, 'bob@test.org', '20')`,
    targetContract: 'contract-typechange-int',
    migrationName: 'retype-score-to-int',
    statements: ['--delete', 'User.score'],
    dirToken: 'retype_score_to_int',
    placeholderId: 'typechange-user-score',
    assertScaffold: (scaffold) => {
      expect(scaffold).toContain('alterColumnType');
    },
    checkReplacement:
      "() => db.public.user.select('id').where((f, fns) => fns.eq(f.id, -1)).limit(1)",
    runReplacement: '() => db.public.user.update({ score: 0 }).where((f, fns) => fns.eq(f.id, -1))',
    assertOps: (ops) => {
      const alterOp = ops.find((op) => op.id.startsWith('alterType.user.score'));
      expect(alterOp, 'alterColumnType op exists').toBeDefined();
      expect(alterOp?.operationClass).toBe('destructive');
    },
    postApplySelect: `SELECT id, email, score FROM "public"."user" ORDER BY id`,
    expectedRows: [
      { id: 1, email: 'alice@example.com', score: 10 },
      { id: 2, email: 'bob@test.org', score: 20 },
    ],
    columnInfoSql: `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'score'`,
    expectedColumnInfo: [{ data_type: 'integer' }],
    assertReapplyNoop: false,
  },
];

withTempDir(({ createTempDir }) => {
  describe.each(scenarios)('Journey: dataTransform — $strategy (planner-assisted)', (scenario) => {
    const db = useDevDatabase();

    it(
      scenario.title,
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        if (scenario.initialContract !== undefined) {
          swapContract(ctx, scenario.initialContract);
        }
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);
        const plan0 = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);
        const apply0 = await runMigrate(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        await sql(db.connectionString, scenario.seedSql);

        // The contract swap is the input the strategy matches on.
        swapContract(ctx, scenario.targetContract);
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit target: ${emit1.stderr}`).toBe(0);

        const planResult = await runMigrationPlan(ctx, [
          '--name',
          scenario.migrationName,
          '--from',
          latestMigrationDirName(ctx),
          ...(scenario.statements ?? []),
        ]);
        expect(planResult.exitCode, `plan: ${planResult.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations', 'app');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes(scenario.dirToken))
          .sort();
        expect(migrationDirs.length, 'planned migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);
        const migrationTsPath = join(migrationDir, 'migration.ts');

        const scaffold = readFileSync(migrationTsPath, 'utf-8');
        expect(scaffold).toContain(`placeholder('${scenario.placeholderId}:check')`);
        expect(scaffold).toContain(`placeholder('${scenario.placeholderId}:run')`);
        scenario.assertScaffold(scaffold);
        const manifestBefore = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        // The package is fully attested even when the planner could not
        // lower any calls because of placeholders: `ops.json` is `[]` and
        // `migrationHash` is the content-address over `(manifest, [])`.
        // The author re-emits after filling in placeholders to rewrite
        // both `ops.json` and `migrationHash`.
        expect(manifestBefore.migrationHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'))).toEqual([]);

        const filled = injectMigrationSqlDbSetup(scaffold)
          .replace(
            `() => placeholder('${scenario.placeholderId}:check')`,
            scenario.checkReplacement,
          )
          .replace(`() => placeholder('${scenario.placeholderId}:run')`, scenario.runReplacement);
        expect(filled).not.toContain('placeholder(');
        expect(filled).toContain('const db = sql(');
        writeFileSync(migrationTsPath, filled);

        const emitResult = await selfEmitMigration(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitResult.exitCode, `emit: ${emitResult.stdout}\n${emitResult.stderr}`).toBe(0);

        const opsAfterEmit = JSON.parse(
          readFileSync(join(migrationDir, 'ops.json'), 'utf-8'),
        ) as readonly {
          id: string;
          operationClass?: string;
          precheck?: readonly unknown[];
          execute?: readonly unknown[];
          postcheck?: readonly unknown[];
        }[];
        const dataTransformOp = opsAfterEmit.find(
          (op) => op.id === `data_migration.${scenario.placeholderId}`,
        );
        expect(dataTransformOp, 'dataTransform op exists').toBeDefined();
        expect(dataTransformOp?.operationClass).toBe('data');
        expect(dataTransformOp?.precheck).toHaveLength(1);
        expect(dataTransformOp?.execute).toHaveLength(1);
        expect(dataTransformOp?.postcheck).toHaveLength(1);
        scenario.assertOps(opsAfterEmit);

        const manifestAfter = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(manifestAfter.migrationHash).toMatch(/^[a-f0-9]{64}$/);

        const apply1 = await runMigrate(ctx);
        expect(apply1.exitCode, `apply: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);

        const result = await sql(db.connectionString, scenario.postApplySelect);
        expect(result.rows).toEqual(scenario.expectedRows);

        const colInfo = await sql(db.connectionString, scenario.columnInfoSql);
        expect(colInfo.rows).toEqual(scenario.expectedColumnInfo);

        if (scenario.assertReapplyNoop) {
          // Re-apply must be a no-op: the marker advanced past this
          // migration and the dataTransform op is idempotency-skipped
          // because its `check` query now returns 0 rows (all NULLs
          // were backfilled by the first apply). Pins both the
          // runner's marker-CAS ledger advance and the data-transform
          // check-driven skip path (spec AC4.2 idempotency half).
          const reapply = await runMigrate(ctx);
          expect(reapply.exitCode, `reapply: ${reapply.stdout}\n${reapply.stderr}`).toBe(0);
          expect(reapply.stderr).toContain('Already up to date');
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
