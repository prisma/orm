import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { runDbInit, setupDbInitFixture } from './utils/db-init-test-helpers';

// Fixture subdirectory for db-init e2e tests
const fixtureSubdir = 'db-init';

withTempDir(({ createTempDir }) => {
  describe('db init command (e2e)', () => {
    describe('empty database (happy path)', () => {
      it(
        'applies migration plan to empty database',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // Set up with empty database (no schema)
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const run = await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            const stripped = stripAnsi(run.stderr);

            // Verify success message
            expect(stripped).toContain('Applied');
            expect(stripped).toContain('operation');

            // Verify marker was created in database
            await withClient(connectionString, async (client) => {
              const result = await client.query(
                'select core_hash, profile_hash from _prisma.signatures where space = $1',
                ['app'],
              );
              expect(result.rows.length).toBe(1);
              expect(result.rows[0]?.core_hash).toBeDefined();
            });

            // Verify table was created
            await withClient(connectionString, async (client) => {
              const result = await client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user'
              `);
              expect(result.rows.length).toBe(1);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs JSON envelope in apply mode',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const run = await runDbInit(testSetup, [
              '--config',
              configPath,
              '--json',
              '--no-color',
            ]);

            const jsonOutput = run.document as Record<string, unknown>;

            // Verify structure
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'apply',
              plan: {
                targetId: expect.any(String),
                destination: {
                  storageHash: expect.any(String),
                },
                operations: expect.any(Array),
              },
              execution: {
                operationsPlanned: expect.any(Number),
                operationsExecuted: expect.any(Number),
              },
              marker: {
                storageHash: expect.any(String),
              },
              summary: expect.any(String),
              timings: {
                total: expect.any(Number),
              },
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('dry-run mode (--dry-run)', () => {
      it(
        'shows planned operations without applying',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const run = await runDbInit(testSetup, [
              '--config',
              configPath,
              '--dry-run',
              '--no-color',
            ]);

            const stripped = stripAnsi(run.stderr);

            // Verify plan output
            expect(stripped).toContain('Planned');
            expect(stripped).toContain('operation');
            expect(stripped).toContain('dry run');

            // Verify no changes were made to database
            await withClient(connectionString, async (client) => {
              // Table should NOT exist
              const tableResult = await client.query(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user'
              `);
              expect(tableResult.rows.length).toBe(0);

              // Marker should NOT exist
              const schemaResult = await client.query(`
                SELECT schema_name FROM information_schema.schemata
                WHERE schema_name = '_prisma'
              `);
              expect(schemaResult.rows.length).toBe(0);
            });
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs JSON envelope in plan mode',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            const run = await runDbInit(testSetup, [
              '--config',
              configPath,
              '--dry-run',
              '--json',
              '--no-color',
            ]);

            const jsonOutput = run.document as Record<string, unknown>;

            // Verify structure
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'plan',
              plan: {
                targetId: expect.any(String),
                destination: {
                  storageHash: expect.any(String),
                },
                operations: expect.any(Array),
              },
              summary: expect.any(String),
              timings: {
                total: expect.any(Number),
              },
            });

            // Verify no execution in plan mode
            expect(jsonOutput).not.toHaveProperty('execution');
            expect(jsonOutput).not.toHaveProperty('marker');
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('marker idempotency', () => {
      it(
        'succeeds as noop when marker already matches destination contract',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Second run: should succeed as noop (0 operations applied)
            const rerun = await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            const stripped = stripAnsi(rerun.stderr);

            // Verify noop - shows "Database already matches contract" indicating nothing to do
            expect(stripped).toContain('Database already matches contract');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'succeeds as noop in plan mode when marker already matches destination',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Second run in plan mode: should succeed as noop with 0 operations
            const rerun = await runDbInit(testSetup, [
              '--config',
              configPath,
              '--dry-run',
              '--no-color',
            ]);

            const stripped = stripAnsi(rerun.stderr);

            // Verify it shows 0 planned operations (indicating nothing to do)
            expect(stripped).toContain('Planned 0 operation');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'outputs correct JSON envelope when marker matches destination',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            // First run: apply to empty database
            const { testSetup, configPath } = await setupDbInitFixture(
              connectionString,
              createTempDir,
              fixtureSubdir,
            );

            await runDbInit(testSetup, ['--config', configPath, '--no-color']);

            // Second run: should succeed as noop
            const rerun = await runDbInit(testSetup, [
              '--config',
              configPath,
              '--json',
              '--no-color',
            ]);

            const jsonOutput = rerun.document as Record<string, unknown>;

            // Verify structure - should be noop with existing marker.
            // The noop case routes through `execute` with an
            // empty plan; the summary reflects the across-spaces envelope
            // rather than a bare "already at target" string.
            expect(jsonOutput).toMatchObject({
              ok: true,
              mode: 'apply',
              plan: {
                targetId: expect.any(String),
                destination: {
                  storageHash: expect.any(String),
                },
                operations: [],
              },
              execution: {
                operationsPlanned: 0,
                operationsExecuted: 0,
              },
              marker: {
                storageHash: expect.any(String),
              },
              summary: expect.stringContaining('Applied 0 operation'),
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
