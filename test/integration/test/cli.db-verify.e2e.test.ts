import { mkdirSync, writeFileSync } from 'node:fs';
import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { seedTestMarker } from '@internal/sql-runtime/test/utils';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';
import {
  type EngineRunResult,
  loadContractFromDisk,
  runOnEngine,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-verify tests
const fixtureSubdir = 'db-verify';

/** Verification found drift or a marker finding; the check itself completed. */
const FINDINGS_EXIT_CODE = 4;

function createTestContract(
  tables: Record<
    string,
    {
      columns: Record<string, { codecId: string; nativeType: string; nullable: boolean }>;
      uniques?: Array<{ columns: string[] }>;
    }
  >,
) {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storage: {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'postgres-schema',
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([name, { columns, uniques = [] }]) => [
                name,
                {
                  columns,
                  primaryKey: { columns: ['id'] },
                  uniques,
                  indexes: [],
                  foreignKeys: [],
                },
              ]),
            ),
          },
        },
      },
    },
    roots: {},
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: Object.fromEntries(
            Object.entries(tables).map(([name, { columns }]) => [
              name,
              {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: name,
                  fields: Object.fromEntries(
                    Object.keys(columns).map((col) => [col, { column: col }]),
                  ),
                },
                fields: Object.fromEntries(
                  Object.entries(columns).map(([col, spec]) => [
                    col,
                    {
                      nullable: spec.nullable,
                      type: { kind: 'scalar' as const, codecId: spec.codecId },
                    },
                  ]),
                ),
                relations: {},
              },
            ]),
          ),
        },
      },
    },
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: 'test',
  };
}

async function emitContract(
  testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>,
): Promise<void> {
  const emit = await runOnEngine(testSetup, ['contract', 'emit']);
  expect(emit.exitCode).toBe(0);
}

function writeSyntheticContract(testDir: string, contractJson: unknown): void {
  mkdirSync(resolve(testDir, 'output'), { recursive: true });
  writeFileSync(
    resolve(testDir, 'output/contract.json'),
    JSON.stringify(contractJson, null, 2),
    'utf-8',
  );
}

/** The run's error envelope, read off the terminal frame of the json stream. */
function settledError(run: EngineRunResult): unknown {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    return undefined;
  }
  return terminal.envelope.error;
}

async function writeMatchingMarker(
  connectionString: string,
  contract: Contract<SqlStorage>,
): Promise<void> {
  await withClient(connectionString, async (client) => {
    await bootstrapPostgresSignMarkerTables(client);

    await seedTestMarker(client, {
      storageHash: contract.storage.storageHash,
      profileHash: contract.profileHash ?? contract.storage.storageHash,
      contractJson: contract,
      canonicalVersion: 1,
    });
  });
}

async function createMatchingSchemaAndMarker(
  connectionString: string,
  contract: Contract<SqlStorage>,
): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id integer NOT NULL,
        email text NOT NULL,
        PRIMARY KEY ("id")
      )
    `);
  });

  await writeMatchingMarker(connectionString, contract);
}

withTempDir(({ createTempDir }) => {
  describe('db verify command (e2e)', () => {
    it(
      'verifies database with matching marker via driver',
      async () => {
        await withDevDatabase(
          async ({ connectionString }) => {
            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            await emitContract(testSetup);

            const contractJsonPath = join(testSetup.testDir, 'output', 'contract.json');
            const contract = loadContractFromDisk<Contract<SqlStorage>>(contractJsonPath);

            await createMatchingSchemaAndMarker(connectionString, contract);

            const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);
            expect(run.exitCode).toBe(0);

            expect(run.presented?.data).toMatchObject({
              ok: true,
              mode: 'full',
              summary: expect.any(String),
              contract: {
                storageHash: contract.storage.storageHash,
              },
              marker: {
                storageHash: contract.storage.storageHash,
              },
              target: {
                expected: expect.any(String),
              },
              schema: {
                summary: expect.any(String),
                strict: expect.any(Boolean),
              },
            });
          },
          // Use random ports to avoid conflicts in CI (no options = random ports)
          {},
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'settles with the findings exit code when marker matches but schema verification fails',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(testSetup);

          const contractJsonPath = join(testSetup.testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<Contract<SqlStorage>>(contractJsonPath);
          await writeMatchingMarker(connectionString, contract);

          const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);
          expect(run.exitCode).toBe(FINDINGS_EXIT_CODE);

          expect(run.presented?.data).toMatchObject({
            ok: false,
            summary: expect.stringContaining('does not satisfy contract'),
            schema: expect.anything(),
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports error when marker is missing via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(testSetup);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await bootstrapPostgresSignMarkerTables(client);
          });

          const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);
          expect(run.exitCode).toBe(FINDINGS_EXIT_CODE);

          expect(run.presented?.data).toMatchObject({
            ok: false,
            mode: 'full',
            summary: 'Marker missing',
          });
          expect(run.presented?.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: 'CONTRACT.MARKER_MISSING',
                summary: expect.stringContaining('Database not signed'),
                why: expect.any(String),
              }),
            ]),
          );
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'runs schema-only verification with matching schema via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);
          });

          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          writeSyntheticContract(
            testSetup.testDir,
            createTestContract({
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                },
              },
            }),
          );

          const run = await runOnEngine(testSetup, ['db', 'verify', '--schema-only', '--json']);
          expect(run.exitCode).toBe(0);

          expect(run.presented?.data).toMatchObject({
            ok: true,
            summary: expect.stringContaining('satisfies contract'),
            schema: expect.anything(),
            meta: {
              strict: false,
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'runs schema-only verification when marker is missing',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL
              )
            `);
          });

          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          writeSyntheticContract(
            testSetup.testDir,
            createTestContract({
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                },
              },
            }),
          );

          const run = await runOnEngine(testSetup, ['db', 'verify', '--schema-only', '--json']);
          expect(run.exitCode).toBe(0);

          expect(run.presented?.data).toMatchObject({
            ok: true,
            summary: expect.stringContaining('satisfies contract'),
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'prints schema-only failure diagnostics even under --quiet',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          // The contract expects a `user` table the database does not have, so
          // the schema-only verify fails.
          writeSyntheticContract(
            testSetup.testDir,
            createTestContract({
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                },
              },
            }),
          );

          const run = await runOnEngine(testSetup, ['db', 'verify', '--schema-only', '--quiet']);
          expect(run.exitCode).toBe(FINDINGS_EXIT_CODE);

          // Exiting non-zero without diagnostics is unhelpful: the failure
          // render overrides --quiet, same as the full-mode branch.
          const rendered = stripAnsi(run.stdout + run.stderr);
          expect(rendered).toContain('user');
          expect(rendered).toContain('does not satisfy contract');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'passes schema-only strict verification when schema matches exactly',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id integer NOT NULL,
                email text NOT NULL,
                PRIMARY KEY ("id")
              )
            `);
          });

          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          writeSyntheticContract(
            testSetup.testDir,
            createTestContract({
              user: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                  email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                },
              },
            }),
          );

          const run = await runOnEngine(testSetup, [
            'db',
            'verify',
            '--schema-only',
            '--strict',
            '--json',
          ]);
          expect(run.exitCode).toBe(0);

          expect(run.presented?.data).toMatchObject({
            ok: true,
            summary: expect.stringContaining('satisfies contract'),
            schema: expect.anything(),
            meta: {
              strict: true,
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'preserves schema-only retry hint when database connection is missing',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(
          createTempDir,
          fixtureSubdir,
          'prisma.config.ts',
        );

        await emitContract(testSetup);

        const run = await runOnEngine(testSetup, [
          'db',
          'verify',
          '--schema-only',
          '--strict',
          '--json',
        ]);
        expect(run.exitCode).toBe(2);

        expect(settledError(run)).toMatchObject({
          code: 'CONFIG.DB_CONNECTION_REQUIRED',
          summary: 'Database connection is required',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining(
                'Run `{bin} db verify --schema-only --strict --db <url>`',
              ),
            }),
          ]),
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fails in strict mode when extra columns exist',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(testSetup);

          const contractJsonPath = join(testSetup.testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<Contract<SqlStorage>>(contractJsonPath);

          await withClient(connectionString, async (client) => {
            await client.query(`
              CREATE TABLE IF NOT EXISTS "user" (
                id integer NOT NULL,
                email text NOT NULL,
                age integer,
                PRIMARY KEY ("id")
              )
            `);
          });
          await writeMatchingMarker(connectionString, contract);

          const run = await runOnEngine(testSetup, ['db', 'verify', '--strict', '--json']);
          expect(run.exitCode).toBe(FINDINGS_EXIT_CODE);

          expect(run.presented?.data).toMatchObject({
            ok: false,
            summary: expect.stringContaining('does not satisfy contract'),
            meta: {
              strict: true,
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON in marker-only mode when --marker-only flag is provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(testSetup);

          const contractJsonPath = join(testSetup.testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<Contract<SqlStorage>>(contractJsonPath);

          await writeMatchingMarker(connectionString, contract);

          const run = await runOnEngine(testSetup, ['db', 'verify', '--marker-only', '--json']);
          expect(run.exitCode).toBe(0);

          expect(run.presented?.data).toMatchObject({
            ok: true,
            mode: 'marker-only',
            summary: expect.any(String),
            contract: {
              storageHash: expect.any(String),
            },
            marker: {
              storageHash: expect.any(String),
            },
            target: {
              expected: expect.any(String),
            },
            meta: {
              contractPath: expect.any(String),
              schemaVerification: 'skipped',
            },
            timings: {
              total: expect.any(Number),
            },
            warning: expect.stringContaining('Schema verification skipped'),
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'rejects mutually exclusive verify modes',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          const run = await runOnEngine(testSetup, [
            'db',
            'verify',
            '--marker-only',
            '--schema-only',
            '--json',
          ]);
          expect(run.exitCode).toBe(2);

          expect(settledError(run)).toMatchObject({
            code: 'CLI.INVALID_VERIFY_MODE',
            summary: 'Invalid verify mode',
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'rejects strict mode when schema verification is skipped',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          const run = await runOnEngine(testSetup, [
            'db',
            'verify',
            '--marker-only',
            '--strict',
            '--json',
          ]);
          expect(run.exitCode).toBe(2);

          expect(settledError(run)).toMatchObject({
            code: 'CLI.INVALID_VERIFY_MODE',
            summary: 'Invalid verify mode',
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports error with JSON when marker is missing and --json flag is provided via driver',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(testSetup);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await bootstrapPostgresSignMarkerTables(client);
          });

          const contractJsonPath = join(testSetup.testDir, 'output', 'contract.json');
          const contract = loadContractFromDisk<Contract<SqlStorage>>(contractJsonPath);
          expect(contract.storage.storageHash).toBeDefined();

          const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);
          expect(run.exitCode).toBe(FINDINGS_EXIT_CODE);

          expect(run.presented?.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: 'CONTRACT.MARKER_MISSING',
                summary: expect.stringContaining('Database not signed'),
                why: expect.any(String),
              }),
            ]),
          );
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports CONFIG.DRIVER_REQUIRED when driver is missing',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Config has db.connection but no driver
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.no-driver.ts',
            { '{{DB_URL}}': connectionString },
          );

          // contract emit needs no driver, so the same config emits the
          // contract the verify run then reads.
          await emitContract(testSetup);

          const run = await runOnEngine(testSetup, ['db', 'verify', '--json']);
          expect(run.exitCode).toBe(2);

          expect(settledError(run)).toMatchObject({
            code: 'CONFIG.DRIVER_REQUIRED',
            summary: expect.stringContaining('Driver is required'),
            why: expect.any(String),
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
