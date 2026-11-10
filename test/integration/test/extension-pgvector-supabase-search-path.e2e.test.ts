import pgvector from '@internal/extension-pgvector/control';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { setUpSupabaseMockSchema } from '../../../packages/3-extensions/supabase/test/fixtures/supabase-reference/set-up-mock-schema';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';

/**
 * The pgvector pack declares `vector` in the unbound namespace, so `db sign` accepts it in any schema on the connection's search path. Supabase installs extensions in schema `extensions` and puts that schema on the `postgres` role's search path.
 */

const JOURNEY_TIMEOUT = timeouts.spinUpPpgDev + timeouts.typeScriptCompilation;

const space = pgvector.contractSpace;
if (space === undefined) throw new Error('the pgvector pack declares no contract space');
const headHash = space.headRef.hash;

async function searchPathOfNewConnection(connectionString: string): Promise<string> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ search_path: string }>('SHOW search_path');
    return result.rows[0]?.search_path ?? '';
  });
}

async function pgvectorMarkerHash(connectionString: string): Promise<string | undefined> {
  return withClient(connectionString, async (client) => {
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass('prisma_contract.marker') IS NOT NULL AS present",
    );
    if (exists.rows[0]?.present !== true) return undefined;
    const result = await client.query<{ core_hash: string }>(
      'SELECT core_hash FROM prisma_contract.marker WHERE space = $1',
      [pgvector.id],
    );
    return result.rows[0]?.core_hash;
  });
}

withTempDir(({ createTempDir }) => {
  describe('a Supabase-shaped database with vector installed in schema extensions', () => {
    async function setUpSupabase(connectionString: string, searchPath: string) {
      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
        await client.query('CREATE EXTENSION vector WITH SCHEMA extensions');
        await client.query(
          'CREATE TABLE public."user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
        );
        await client.query(`SET search_path TO ${searchPath}`);
      });
      const project = setupTestDirectoryFromFixtures(
        createTempDir,
        'extension-packs',
        'prisma.config.with-db.ts',
        { '{{DB_URL}}': connectionString },
      );
      const emit = await runOnEngine(project, ['contract', 'emit']);
      expect(emit.exitCode, `contract emit: ${emit.stderr}`).toBe(0);
      return project;
    }

    it(
      'signs the pgvector space with Supabase\'s search path, "$user", public, extensions, set on the one PGlite session because ALTER ROLE applies only to new backends',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await setUpSupabase(connectionString, '"$user", public, extensions');
          expect(await searchPathOfNewConnection(connectionString)).toBe(
            '"$user", public, extensions',
          );

          const sign = await runOnEngine(project, ['db', 'sign']);
          expect(sign.exitCode, `db sign: ${sign.stdout}${sign.stderr}`).toBe(0);
          expect(await pgvectorMarkerHash(connectionString)).toBe(headHash);

          const verify = await runOnEngine(project, ['db', 'verify', '--strict']);
          expect(verify.exitCode, `db verify --strict: ${verify.stderr}`).toBe(0);
        });
      },
      JOURNEY_TIMEOUT,
    );

    it(
      'refuses to sign when the search path is public only, naming the schema and the search path',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await setUpSupabase(connectionString, 'public');
          expect(await searchPathOfNewConnection(connectionString)).toBe('public');

          const sign = await runOnEngine(project, ['db', 'sign']);
          expect(sign.exitCode).not.toBe(0);
          expect(`${sign.stdout}${sign.stderr}`).toContain(
            'extension "vector" is installed in schema "extensions", which is not on the search path (pg_catalog, public). Add schema "extensions" to the connection\'s search_path, or reinstall the extension in a schema on it.',
          );
          expect(await pgvectorMarkerHash(connectionString)).toBeUndefined();
        });
      },
      JOURNEY_TIMEOUT,
    );
  });
});
