import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import {
  runOnEngine,
  setupDbTestFixture,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

// Fixture subdirectory for db-sign e2e tests
const fixtureSubdir = 'db-sign';

// Default schema for db-sign tests
const DEFAULT_USER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS "user" (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL
  )
`;

/**
 * Sets up a database schema and test directory for db-sign e2e tests.
 * Creates a "user" table with id and email columns by default.
 */
async function setupDbSignFixture(
  connectionString: string,
  createTempDir: () => string,
  fixtureSubdir: string,
  schemaSql?: string,
): Promise<{ testSetup: ReturnType<typeof setupTestDirectoryFromFixtures>; configPath: string }> {
  return setupDbTestFixture({
    connectionString,
    createTempDir,
    fixtureSubdir,
    schemaSql: schemaSql ?? DEFAULT_USER_TABLE_SQL,
  });
}

withTempDir(({ createTempDir }) => {
  describe('db sign command (e2e)', () => {
    it(
      'creates marker when schema matches contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          const run = await runOnEngine(testSetup, ['db', 'sign']);
          expect(run.exitCode).toBe(0);

          // Verify marker was created in database
          await withClient(connectionString, async (client) => {
            const result = await client.query(
              'select core_hash, profile_hash from prisma_contract.marker where space = $1',
              ['app'],
            );
            expect(result.rows.length).toBe(1);
            expect(result.rows[0]?.core_hash).toBeDefined();
          });

          const output = stripAnsi(run.stderr);
          expect(output).toContain('Database signed');
          expect(output).toMatch(/app: signed \S+ \(no marker before\)/);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'fails when schema does not match contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          // Set up database schema that does NOT match contract (missing table)
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
            `
              CREATE TABLE IF NOT EXISTS "post" (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL
              )
            `,
          );

          const run = await runOnEngine(testSetup, ['db', 'sign']);
          expect(run.exitCode).not.toBe(0);

          // Verify marker was NOT created in database
          await withClient(connectionString, async (client) => {
            // Ensure marker table exists (might have been created by sign attempt)
            await client.query(`
                CREATE SCHEMA IF NOT EXISTS prisma_contract
              `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS prisma_contract.marker (
                  space text not null primary key default 'app',
                  core_hash text not null,
                  profile_hash text not null,
                  contract_json jsonb,
                  canonical_version int,
                  updated_at timestamptz not null default now(),
                  app_tag text,
                  meta jsonb not null default '{}',
                  invariants text[] not null default '{}'
                )
              `);
            const result = await client.query(
              'select count(*) as count from prisma_contract.marker where space = $1',
              ['app'],
            );
            // Marker should not exist (sign should have failed before writing)
            expect(Number.parseInt(result.rows[0]?.count ?? '0', 10)).toBe(0);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON envelope with real database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          const run = await runOnEngine(testSetup, ['db', 'sign', '--json']);
          expect(run.exitCode).toBe(0);

          expect(run.presented?.data).toMatchObject({
            ok: true,
            summary: 'Database signed',
            spaces: [
              {
                space: 'app',
                status: 'signed',
                contract: {
                  storageHash: expect.any(String),
                  profileHash: expect.any(String),
                },
                marker: {
                  created: true,
                  updated: false,
                },
              },
            ],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles missing contract file (ENOENT error)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          // Don't emit contract.json - it should be missing
          const run = await runOnEngine(testSetup, ['db', 'sign', '--json']);
          expect(run.exitCode).not.toBe(0);

          expect(run.json.at(-1)).toMatchObject({
            kind: 'result',
            envelope: {
              ok: false,
              error: {
                code: 'CLI.FILE_NOT_FOUND',
                summary: expect.stringMatching(/file.*not found|not found.*file/i),
              },
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles contract file read errors (non-ENOENT)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            fixtureSubdir,
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          // Create a contract file with invalid JSON (causes parse error, not ENOENT)
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          mkdirSync(dirname(contractPath), { recursive: true });
          writeFileSync(contractPath, 'invalid json content', 'utf-8');

          // Tests the branch where the file read succeeds but JSON.parse fails
          const run = await runOnEngine(testSetup, ['db', 'sign', '--json']);
          expect(run.exitCode).not.toBe(0);

          expect(run.json.at(-1)).toMatchObject({
            kind: 'result',
            envelope: {
              ok: false,
              error: { code: expect.any(String) },
            },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles quiet mode flag',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          const run = await runOnEngine(testSetup, ['db', 'sign', '--quiet']);
          expect(run.exitCode).toBe(0);

          // Quiet mode suppresses progress reporting but keeps the result
          const output = stripAnsi(run.stdout + run.stderr);
          expect(output).not.toContain('Connecting to database');
          expect(output).toContain('Database signed');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'settles with the findings exit code when schema verification fails',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
            `
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY
              )
            `,
          );

          // Contract expects both id and email columns, but database only has id
          // Modify the emitted contract to expect email column
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          const { readFile, writeFile } = await import('node:fs/promises');
          const contractJson = JSON.parse(await readFile(contractPath, 'utf-8'));
          contractJson.storage.namespaces.public.entries.table.user.columns.email = {
            codecId: 'pg/text@1',
            dataType: 'pg/text',
            nullable: false,
          };
          await writeFile(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const run = await runOnEngine(testSetup, ['db', 'sign']);
          expect(run.exitCode).toBe(4);

          // Verify that schema verification output was printed (not sign output)
          const output = stripAnsi(run.stderr);
          expect(output).toContain('does not satisfy contract');
          expect(output).not.toContain('Database signed');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'outputs JSON when schema verification fails with --json flag',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
            `
              CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY
              )
            `,
          );

          // Contract expects both id and email columns, but database only has id
          // Modify the emitted contract to expect email column
          const contractPath = resolve(testSetup.testDir, 'src/prisma/contract.json');
          const { readFile, writeFile } = await import('node:fs/promises');
          const contractJson = JSON.parse(await readFile(contractPath, 'utf-8'));
          contractJson.storage.namespaces.public.entries.table.user.columns.email = {
            codecId: 'pg/text@1',
            dataType: 'pg/text',
            nullable: false,
          };
          await writeFile(contractPath, JSON.stringify(contractJson, null, 2), 'utf-8');

          const run = await runOnEngine(testSetup, ['db', 'sign', '--json']);
          expect(run.exitCode).toBe(4);

          expect(run.presented?.data).toMatchObject({
            ok: false,
            summary: expect.stringContaining('does not satisfy contract'),
            spaces: [{ space: 'app', status: 'failed', schema: expect.anything() }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'formats sign output when schema verification passes',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup } = await setupDbSignFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          const run = await runOnEngine(testSetup, ['db', 'sign']);
          expect(run.exitCode).toBe(0);

          // Verify that sign output was formatted (not schema verification output)
          const output = stripAnsi(run.stderr);
          expect(output).toContain('Database signed');
          expect(output).not.toContain('does not satisfy contract');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
