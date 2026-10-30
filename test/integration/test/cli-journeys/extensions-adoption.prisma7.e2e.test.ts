/**
 * Adopting a database built by Prisma 7 from a schema whose datasource lists `extensions = [vector, pg_trgm]`, with the pgvector pack composed in `prisma.config.ts`. `contract emit` leaves `vector` to the pack and declares `pg_trgm` in the application's contract, and writes the pack's pinned files. `db sign` writes both markers without running a migration, `db verify --strict` is clean, and a fresh database built from `migrations/` alone ends up with both extensions.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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

const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');

const PRISMA7_DATABASE = `
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";
  CREATE EXTENSION IF NOT EXISTS "vector";
  CREATE TABLE "User" (
    "id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  );
`;

function pinnedPgvector(testDir: string): {
  readonly head: string;
  readonly oneStep: string | undefined;
} {
  const dir = join(testDir, 'migrations', 'pgvector');
  const head: string = JSON.parse(readFileSync(join(dir, 'refs', 'head.json'), 'utf-8')).hash;
  const oneStep = readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'migration.json')))
    .find((name) => {
      const metadata = JSON.parse(readFileSync(join(dir, name, 'migration.json'), 'utf-8'));
      return metadata.from === null && metadata.to === head;
    });
  return { head, oneStep };
}

function setupProject(createTempDir: () => string, connectionString: string): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  copyFileSync(
    join(JOURNEY_FIXTURES, 'schema.prisma7-extensions.prisma'),
    join(testDir, 'schema.prisma'),
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(
    configPath,
    readFileSync(join(JOURNEY_FIXTURES, 'prisma.config.prisma7.pgvector.ts'), 'utf-8').replace(
      /\{\{DB_URL\}\}/g,
      () => connectionString,
    ),
  );
  return { testDir, configPath, outputDir: testDir };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return stripAnsi(`${run.stdout}\n${run.stderr}`);
}

async function installedExtensions(connectionString: string): Promise<readonly string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      "SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'vector') ORDER BY extname",
    );
    return result.rows.map((row) => row.extname);
  });
}

async function markerInvariants(
  connectionString: string,
): Promise<Record<string, readonly string[]>> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, invariants FROM prisma_contract.marker ORDER BY space',
    );
    return Object.fromEntries(result.rows.map((row) => [row.space, row.invariants]));
  });
}

async function appliedMigrations(connectionString: string, spaceId: string): Promise<string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT migration_name FROM prisma_contract.ledger WHERE space = $1 ORDER BY id',
      [spaceId],
    );
    return result.rows.map((row) => row.migration_name);
  });
}

async function pgvectorMarkerHash(connectionString: string): Promise<string | undefined> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      "SELECT core_hash FROM prisma_contract.marker WHERE space = 'pgvector'",
    );
    return result.rows[0]?.core_hash;
  });
}

interface EmittedContract {
  readonly storage: {
    readonly namespaces: Record<string, { readonly entries: { readonly extension?: object } }>;
  };
}

function declaredExtensions(testDir: string): Record<string, object | undefined> {
  const contract: EmittedContract = JSON.parse(
    readFileSync(join(testDir, 'contract.json'), 'utf-8'),
  );
  return Object.fromEntries(
    Object.entries(contract.storage.namespaces).map(([id, namespace]) => [
      id,
      namespace.entries.extension,
    ]),
  );
}

withTempDir(({ createTempDir }) => {
  describe('adopting a Prisma 7 database whose datasource lists vector and pg_trgm', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_DATABASE)),
    });

    it(
      'emits, signs, verifies strictly, and rebuilds a fresh database from migrations',
      async () => {
        const ctx = setupProject(createTempDir, db.connectionString);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(declaredExtensions(ctx.testDir)).toEqual({
          public: { pg_trgm: { kind: 'extension', name: 'pg_trgm' } },
        });
        const pinned = pinnedPgvector(ctx.testDir);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
        expect(await markerInvariants(db.connectionString)).toEqual({ app: [], pgvector: [] });
        expect(await pgvectorMarkerHash(db.connectionString)).toBe(pinned.head);

        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `db verify --strict\n${output(verify)}`).toBe(0);

        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, `migration plan\n${output(plan)}`).toBe(0);

        await withDevDatabase(async ({ connectionString }) => {
          const fresh = await runMigrate(ctx, ['--db', connectionString]);
          expect(fresh.exitCode, `db migrate on a fresh database\n${output(fresh)}`).toBe(0);
          expect(await installedExtensions(connectionString)).toEqual(['pg_trgm', 'vector']);
          expect(pinned.oneStep).toBeDefined();
          expect(await appliedMigrations(connectionString, 'pgvector')).toEqual([pinned.oneStep]);
          expect(await markerInvariants(connectionString)).toEqual({ app: [], pgvector: [] });
          expect(await pgvectorMarkerHash(connectionString)).toBe(pinned.head);
          const verifyFresh = await runDbVerify(ctx, ['--strict', '--db', connectionString]);
          expect(verifyFresh.exitCode, `db verify --strict\n${output(verifyFresh)}`).toBe(0);
        });
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
