import { existsSync, readFileSync } from 'node:fs';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';

const fixtureSubdir = 'db-introspect';

withTempDir(({ createTempDir }) => {
  describe('live schema CLI commands (e2e)', () => {
    describe('db schema', () => {
      it(
        'prints the live schema tree without writing files',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            await withClient(connectionString, async (client) => {
              await client.query(`
                CREATE TABLE IF NOT EXISTS "user" (
                  id SERIAL PRIMARY KEY,
                  email TEXT NOT NULL,
                  name TEXT
                )
              `);
              await client.query(`
                CREATE TABLE IF NOT EXISTS "post" (
                  id SERIAL PRIMARY KEY,
                  title TEXT NOT NULL,
                  "userId" INTEGER REFERENCES "user"(id)
                )
              `);
              await client.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user"(email)
              `);
            });

            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            const run = await runOnEngine(testSetup, ['db', 'schema']);
            expect(run.exitCode).toBe(0);

            expect(existsSync(join(testSetup.testDir, 'output/contract.prisma'))).toBe(false);

            const tree = stripAnsi(run.stderr);
            expect(tree).toContain('table user');
            expect(tree).toContain('table post');
            expect(tree).toContain('id: int4 (not nullable)');
            expect(tree).toContain('email: text (not nullable)');
            expect(tree).toContain('name: text (nullable)');
            expect(tree).toContain('primary key: id');
            expect(tree).toContain('unique index user_email_unique');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        '--json prints raw schema output without writing files',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            await withClient(connectionString, async (client) => {
              await client.query(`
                CREATE TABLE IF NOT EXISTS "simple" (
                  id SERIAL PRIMARY KEY
                )
              `);
            });

            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            const run = await runOnEngine(testSetup, ['db', 'schema', '--json']);
            expect(run.exitCode).toBe(0);

            expect(existsSync(join(testSetup.testDir, 'output/contract.prisma'))).toBe(false);

            expect(run.presented?.data).toMatchObject({
              ok: true,
              summary: 'Schema read successfully',
              schema: expect.any(Object),
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract infer', () => {
      it(
        'writes a full PSL snapshot to output/contract.prisma',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            await withClient(connectionString, async (client) => {
              await client.query(`
                CREATE TABLE IF NOT EXISTS "user" (
                  id SERIAL PRIMARY KEY,
                  email TEXT NOT NULL,
                  name TEXT,
                  token UUID NOT NULL DEFAULT gen_random_uuid()
                )
              `);
            });

            const testSetup = setupTestDirectoryFromFixtures(
              createTempDir,
              fixtureSubdir,
              'prisma.config.with-db.ts',
              { '{{DB_URL}}': connectionString },
            );

            const run = await runOnEngine(testSetup, ['contract', 'infer']);
            expect(run.exitCode).toBe(0);

            const pslPath = join(testSetup.testDir, 'output/contract.prisma');
            expect(existsSync(pslPath)).toBe(true);
            expect(readFileSync(pslPath, 'utf-8')).toBe(`// use prisma-8
// Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

model User {
  id    Int     @id(map: "user_pkey") @default(autoincrement())
  email String
  name  String?
  token Uuid    @default(dbgenerated("gen_random_uuid()"))

  @@map("user")
}
`);

            expect(stripAnsi(run.stderr)).toContain('output/contract.prisma');
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        '--json includes the inferred PSL path',
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

            const run = await runOnEngine(testSetup, ['contract', 'infer', '--json']);
            expect(run.exitCode).toBe(0);

            expect(run.presented?.data).toMatchObject({
              ok: true,
              summary: 'Contract inferred successfully',
              psl: { path: 'output/contract.prisma' },
            });
          });
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
