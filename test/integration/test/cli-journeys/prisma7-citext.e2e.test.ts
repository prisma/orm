/**
 * Adopting a database Prisma 7 built from a schema with `@db.Citext` columns whose datasource lists `extensions = [citext]`, with the citext pack composed in `prisma.config.ts`. The pack's contract declares the extension, so `contract emit` leaves it out of the application's contract and writes the pack's pinned files, `db sign` writes both markers without running a migration, and `db verify --strict` is clean. No `migration plan` runs before adoption. A fresh database built from `migrations/` alone then has the extension and the tables.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbVerify,
  runMigrate,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CITEXT_FIXTURE = join(__dirname, '../fixtures/prisma7-source/citext');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');

const DATASOURCE = 'datasource db {\n  provider = "postgresql"\n}';
const DATASOURCE_LISTING_CITEXT = `datasource db {
  provider   = "postgresql"
  extensions = [citext]
}

generator client {
  provider        = "prisma-client"
  output          = "../generated/prisma"
  previewFeatures = ["postgresqlExtensions"]
}`;

/** What Prisma 7 runs for the schema once its datasource lists citext: the extension, then the recorded tables. */
const PRISMA7_DATABASE = `CREATE EXTENSION IF NOT EXISTS "citext";\n${readFileSync(
  join(CITEXT_FIXTURE, 'migration.sql'),
  'utf-8',
)}`;

function schemaListingCitext(): string {
  const schema = readFileSync(join(CITEXT_FIXTURE, 'schema.prisma'), 'utf-8');
  if (!schema.includes(DATASOURCE)) throw new Error('The citext fixture changed its datasource');
  return schema.replace(DATASOURCE, DATASOURCE_LISTING_CITEXT);
}

function setupProject(createTempDir: () => string, connectionString: string): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  writeFileSync(join(testDir, 'schema.prisma'), schemaListingCitext(), 'utf-8');
  copyFileSync(
    join(JOURNEY_FIXTURES, 'prisma.config.prisma7-citext.ts'),
    join(testDir, 'prisma.config.ts'),
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    readFileSync(configPath, 'utf-8').replace(/\{\{DB_URL\}\}/g, () => connectionString),
  );
  return { testDir, configPath, outputDir: testDir };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return stripAnsi(`${run.stdout}\n${run.stderr}`);
}

function pinnedCitextHead(testDir: string): string {
  return JSON.parse(
    readFileSync(join(testDir, 'migrations', 'citext', 'refs', 'head.json'), 'utf-8'),
  ).hash;
}

function declaredExtensions(testDir: string): Record<string, object | undefined> {
  const contract: {
    readonly storage: {
      readonly namespaces: Record<string, { readonly entries: { readonly extension?: object } }>;
    };
  } = JSON.parse(readFileSync(join(testDir, 'contract.json'), 'utf-8'));
  return Object.fromEntries(
    Object.entries(contract.storage.namespaces).map(([id, namespace]) => [
      id,
      namespace.entries.extension,
    ]),
  );
}

async function markers(
  connectionString: string,
): Promise<Record<string, { readonly hash: string; readonly invariants: readonly string[] }>> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, core_hash, invariants FROM prisma_contract.marker ORDER BY space',
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.space, { hash: row.core_hash, invariants: row.invariants }]),
    );
  });
}

async function citextTables(connectionString: string): Promise<readonly string[]> {
  return withClient(connectionString, async (client) => {
    const extension = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'citext'");
    const tables = await client.query(
      "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND udt_name IN ('citext', '_citext') ORDER BY table_name",
    );
    return extension.rowCount === 1 ? tables.rows.map((row) => row.table_name) : [];
  });
}

withTempDir(({ createTempDir }) => {
  describe('adopting a Prisma 7 database with citext columns and extensions = [citext]', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_DATABASE)),
    });

    it(
      'emits, signs and verifies strictly with no migration plan, and rebuilds a fresh database from migrations',
      async () => {
        const ctx = setupProject(createTempDir, db.connectionString);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(declaredExtensions(ctx.testDir)).toEqual({ public: undefined });
        const head = pinnedCitextHead(ctx.testDir);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
        expect(await markers(db.connectionString)).toMatchObject({
          app: { invariants: [] },
          citext: { hash: head, invariants: [] },
        });

        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `db verify --strict\n${output(verify)}`).toBe(0);

        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, `migration plan\n${output(plan)}`).toBe(0);

        await withDevDatabase(async ({ connectionString }) => {
          const fresh = await runMigrate(ctx, ['--db', connectionString]);
          expect(fresh.exitCode, `db migrate on a fresh database\n${output(fresh)}`).toBe(0);
          expect(await citextTables(connectionString)).toEqual([
            'Account',
            'CitextDefaults',
            'Post',
            'Review',
          ]);
          expect(await markers(connectionString)).toMatchObject({
            citext: { hash: head, invariants: [] },
          });
          const verifyFresh = await runDbVerify(ctx, ['--strict', '--db', connectionString]);
          expect(verifyFresh.exitCode, `db verify --strict\n${output(verifyFresh)}`).toBe(0);
        });
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
