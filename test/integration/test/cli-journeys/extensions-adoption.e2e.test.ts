/**
 * Adopting a database that has two Postgres extensions: `pg_trgm`, which the app contract declares, and `vector`, which the composed pgvector pack declares. `contract emit` writes the pack's pinned files, `db sign` writes both markers without running a migration, and `db verify --strict` is clean. A later app change migrates with `db migrate`, and a fresh database built from `migrations/` alone ends up with both extensions.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  pgvectorPslConfigFixture,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbVerify,
  runMigrate,
  setupJourney,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_DATABASE = `
  CREATE EXTENSION pg_trgm;
  CREATE EXTENSION vector;
  CREATE TABLE "user" (id int4 PRIMARY KEY, email text NOT NULL);
`;

function composePgvector(ctx: JourneyContext, connectionString: string): void {
  const config = readFileSync(pgvectorPslConfigFixture, 'utf-8');
  writeFileSync(
    ctx.configPath,
    config.replace(/\{\{DB_URL\}\}/g, () => connectionString),
  );
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

async function appliedMigrations(connectionString: string, spaceId: string): Promise<string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT migration_name FROM prisma_contract.ledger WHERE space = $1 ORDER BY id',
      [spaceId],
    );
    return result.rows.map((row) => row.migration_name);
  });
}

withTempDir(({ createTempDir }) => {
  describe('adopting a database with an app extension and a pack extension', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_DATABASE)),
    });

    it(
      'signs, verifies strictly, migrates a later change, and rebuilds a fresh database from migrations',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        composePgvector(ctx, db.connectionString);
        swapPslContract(ctx, 'contract-extensions');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const pgvectorDir = join(ctx.testDir, 'migrations', 'pgvector');
        expect(existsSync(join(pgvectorDir, 'refs', 'head.json'))).toBe(true);

        const pinned = pinnedPgvector(ctx.testDir);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
        expect(await markers(db.connectionString)).toEqual({
          app: { hash: expect.any(String), invariants: [] },
          pgvector: { hash: pinned.head, invariants: [] },
        });
        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `db verify --strict\n${output(verify)}`).toBe(0);

        swapPslContract(ctx, 'contract-extensions-name');
        const emitChange = await runContractEmit(ctx);
        expect(emitChange.exitCode, `contract emit\n${output(emitChange)}`).toBe(0);
        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'add-name']);
        expect(plan.exitCode, `migration plan\n${output(plan)}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `db migrate\n${output(migrate)}`).toBe(0);
        const verifyChange = await runDbVerify(ctx, ['--strict']);
        expect(verifyChange.exitCode, `db verify --strict\n${output(verifyChange)}`).toBe(0);

        await withDevDatabase(async ({ connectionString }) => {
          const fresh = await runMigrate(ctx, ['--db', connectionString]);
          expect(fresh.exitCode, `db migrate on a fresh database\n${output(fresh)}`).toBe(0);
          expect(await installedExtensions(connectionString)).toEqual(['pg_trgm', 'vector']);
          expect(pinned.oneStep).toBeDefined();
          expect(await appliedMigrations(connectionString, 'pgvector')).toEqual([pinned.oneStep]);
          expect(await markers(connectionString)).toEqual({
            app: { hash: expect.any(String), invariants: [] },
            pgvector: { hash: pinned.head, invariants: [] },
          });
          const verifyFresh = await runDbVerify(ctx, ['--strict', '--db', connectionString]);
          expect(verifyFresh.exitCode, `db verify --strict\n${output(verifyFresh)}`).toBe(0);
        });
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
