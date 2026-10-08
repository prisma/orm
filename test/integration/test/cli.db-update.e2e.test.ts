import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { fixtureAppDir, runOnEngine, withTempDir } from './utils/cli-test-helpers';
import { replaceInFileOrThrow } from './utils/contract-fixture-editing';
import { runDbInit } from './utils/db-init-test-helpers';
import {
  type DbUpdateTestSetup,
  runDbUpdate,
  runDbUpdateAllowFailure,
  setupDbUpdateFixture,
} from './utils/db-update-test-helpers';

const fixtureSubdir = 'db-init';

function addNicknameColumnToContract(testDir: string): void {
  replaceInFileOrThrow(
    join(testDir, 'contract.ts'),
    '        email: field.column(textColumn),\n',
    '        email: field.column(textColumn),\n        nickname: field.column(textColumn).optional(),\n',
  );
}

async function emitContract(testSetup: DbUpdateTestSetup): Promise<void> {
  const run = await runOnEngine(testSetup, ['contract', 'emit']);
  expect(run.exitCode).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('db update command (e2e)', () => {
    it(
      'is a no-op when database already matches current contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          // Init the database with the contract
          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Run db update immediately without changing the contract
          const plan = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run']);
          expect(stripAnsi(plan.stderr)).toContain('Planned 0 operation(s)');

          const apply = await runDbUpdate(testSetup, ['--config', configPath]);
          expect(stripAnsi(apply.stderr)).toContain('Database already matches contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'plans and applies contract changes from signed state',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          addNicknameColumnToContract(testSetup.testDir);
          await emitContract(testSetup);

          const plan = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run']);
          const planOutput = stripAnsi(plan.stderr);
          expect(planOutput).toContain('Planned');
          expect(planOutput).toContain('nickname');
          expect(planOutput).toContain('DDL preview');

          const apply = await runDbUpdate(testSetup, ['--config', configPath]);
          expect(stripAnsi(apply.stderr)).toContain('Applied');

          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'user'
                AND column_name = 'nickname'
            `);
            expect(columnResult.rows.length).toBe(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns JSON envelope in plan mode',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          addNicknameColumnToContract(testSetup.testDir);
          await emitContract(testSetup);

          const run = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--json']);
          const payload = run.document as Record<string, unknown>;

          expect(payload).toMatchObject({
            ok: true,
            mode: 'plan',
            plan: {
              targetId: expect.any(String),
              destination: { storageHash: expect.any(String) },
              operations: expect.any(Array),
              preview: { statements: expect.any(Array) },
            },
          });

          const previewStatements = (
            payload as {
              plan: {
                preview: {
                  statements: ReadonlyArray<{ language: string; text: string }>;
                };
              };
            }
          ).plan.preview.statements;
          const sqlStatements = previewStatements.filter((s) => s.language === 'sql');
          expect(sqlStatements.length).toBeGreaterThan(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});

// ---------------------------------------------------------------------------
// Rich account/project reconciliation scenarios
// ---------------------------------------------------------------------------

const scenarioFixtureSubdir = 'db-update-scenarios';
const projectSlugVariantFixture = 'contract-add-project-slug.ts';

/**
 * Switches the baseline scenario contract to the additive project slug variant,
 * then re-emits the contract.
 */
async function switchToProjectSlugVariant(testSetup: DbUpdateTestSetup): Promise<void> {
  const variantSource = join(
    fixtureAppDir,
    'fixtures',
    scenarioFixtureSubdir,
    projectSlugVariantFixture,
  );
  const contractDest = join(testSetup.testDir, 'contract.ts');
  copyFileSync(variantSource, contractDest);

  await emitContract(testSetup);
}

withTempDir(({ createTempDir }) => {
  describe('db update scenarios', () => {
    // Scenario 1: Fresh database without prior db init
    it(
      'succeeds on a fresh database without prior db init',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          // db update should work on a fresh database without db init
          const plan = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run']);
          expect(stripAnsi(plan.stderr)).toContain('Planned');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 2: Preview a contract change (plan mode)
    it(
      'previews contract change in plan mode without applying',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToProjectSlugVariant(testSetup);

          const plan = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run']);
          const planOutput = stripAnsi(plan.stderr);

          expect(planOutput).toContain('Planned');
          expect(planOutput).toContain('slug');
          expect(planOutput).toContain('dry run');

          // Verify no changes applied to database
          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'project'
                AND column_name = 'slug'
            `);
            expect(columnResult.rows.length).toBe(0);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 3: Apply the update
    it(
      'applies contract changes and writes marker',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToProjectSlugVariant(testSetup);

          const apply = await runDbUpdate(testSetup, ['--config', configPath]);
          const applyOutput = stripAnsi(apply.stderr);

          expect(applyOutput).toContain('Applied');
          // The per-space tree ends on the marker the space was signed with.
          expect(applyOutput).toMatch(/marker /);

          // Verify slug column exists in database
          await withClient(connectionString, async (client) => {
            const columnResult = await client.query(`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'project'
                AND column_name = 'slug'
            `);
            expect(columnResult.rows.length).toBe(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 4: No-op update
    it(
      'applies zero operations when database already matches contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          const apply = await runDbUpdate(testSetup, ['--config', configPath]);

          expect(stripAnsi(apply.stderr)).toContain('Database already matches contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 5: Destructive changes with a safety review
    it(
      'shows destructive operations in plan mode for drifted schema',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Inject drift: extra column and extra table not in contract
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."account" ADD COLUMN "legacy_code" text');
            await client.query(
              'CREATE TABLE "public"."legacy_audit" (id int4 PRIMARY KEY, note text)',
            );
          });

          const plan = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run']);
          const planOutput = stripAnsi(plan.stderr);

          expect(planOutput).toContain('legacy_code');
          expect(planOutput).toContain('destructive');
          expect(planOutput).toContain('legacy_audit');
          expect(planOutput).toContain('dry run');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 6: Planning conflicts
    it(
      'fails with planning conflict when live schema diverges from contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Swap primary key: drop FK first, then drop PK on id, add PK on email
          await withClient(connectionString, async (client) => {
            await client.query(
              'ALTER TABLE "public"."project" DROP CONSTRAINT IF EXISTS "project_accountId_fkey"',
            );
            await client.query(
              'ALTER TABLE "public"."account" DROP CONSTRAINT IF EXISTS "account_pkey"',
            );
            await client.query('ALTER TABLE "public"."account" ADD PRIMARY KEY ("email")');
          });

          const run = await runDbUpdateAllowFailure(testSetup, ['--config', configPath]);

          expect(run.exitCode).not.toBe(0);
          expect(stripAnsi(run.stderr)).toMatch(/conflict|PLANNING_FAILED/i);
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 7a: Destructive changes need a statement that answers them
    it(
      'refuses a drop no statement answers, naming the storage it would lose',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Add drift column so the planner generates a destructive drop
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."project" ADD COLUMN "legacy_notes" text');
          });

          const run = await runDbUpdateAllowFailure(testSetup, [
            '--config',
            configPath,
            '--no-interactive',
          ]);

          expect(run.exitCode).toBe(2);
          expect(stripAnsi(run.stderr)).toMatch(/CONSENT_REQUIRED/);
          expect(stripAnsi(run.stderr)).toContain('--delete public.project.legacy_notes');

          // Verify the refusal actually blocked the update —
          // the drift column must still exist
          await withClient(connectionString, async (client) => {
            const result = await client.query(
              `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project' AND column_name = 'legacy_notes'`,
            );
            expect(result.rows).toHaveLength(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 7b: Runner failure after planning (with -y)
    it(
      'fails during apply when a blocking view prevents column drop',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Add drift column + blocking view
          await withClient(connectionString, async (client) => {
            await client.query('ALTER TABLE "public"."project" ADD COLUMN "legacy_notes" text');
            await client.query(
              'CREATE VIEW "public"."legacy_notes_view" AS SELECT id, legacy_notes FROM "public"."project"',
            );
          });

          const run = await runDbUpdateAllowFailure(testSetup, [
            '--config',
            configPath,
            '--delete',
            'public.project.legacy_notes',
          ]);

          expect(run.exitCode).not.toBe(0);
          const allOutput = stripAnsi(run.stderr);
          // The runner attempts to drop legacy_notes but the view blocks it.
          // The post-apply schema verification detects the column still exists.
          expect(allOutput).toContain('legacy_notes');
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Scenario 8: JSON output for tooling
    it(
      'returns JSON envelope in plan mode with rich contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            scenarioFixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await switchToProjectSlugVariant(testSetup);

          const run = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--json']);
          const payload = run.document as Record<string, unknown>;

          expect(payload).toMatchObject({
            ok: true,
            mode: 'plan',
            plan: {
              targetId: expect.any(String),
              destination: { storageHash: expect.any(String) },
              operations: expect.any(Array),
            },
            summary: expect.any(String),
            timings: {
              total: expect.any(Number),
            },
          });
          expect(payload).not.toHaveProperty('origin');

          const operations = (payload as { plan: { operations: unknown[] } }).plan.operations;
          expect(operations.length).toBeGreaterThan(0);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
