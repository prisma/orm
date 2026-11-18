import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(exampleDir, 'src', 'prisma', 'contract.prisma');
const contractJsonPath = join(exampleDir, 'src', 'prisma', 'contract.json');

// Bootstraps Prisma 8's marker table plus our own model tables via raw DDL
// rather than going through the control client's `dbInit`. This smoke test's job
// is to validate auto-emit and serving through the framework runtime, not to
// exercise the migration system — that is covered by the `db init` integration
// tests in `test/integration/test/cli.db-init.e2e.test.ts`. Inlining the DDL keeps
// this test readable top-to-bottom without a fixture file or a control-client
// setup that would expand the scope and the flake surface.
const TEST_SCHEMA_SQL = `
create schema if not exists prisma_contract;
create table if not exists prisma_contract.marker (
  space text not null primary key default 'app',
  core_hash text not null default '',
  profile_hash text not null default '',
  contract_json jsonb,
  canonical_version int,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}',
  invariants text[] not null default '{}'
);
create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  "createdAt" timestamptz not null default now()
);
create table if not exists "post" (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  "userId" uuid not null references "user"(id),
  "createdAt" timestamptz not null default now()
);
`;

// Single `stat()` with ENOENT swallowed — using `existsSync` + `stat` instead
// would TOCTOU-race the emitter's atomic publish (temp-write + rename), which
// briefly leaves no file at the target path. Treat ENOENT as "not yet"; rethrow
// any other error so genuine I/O failures still surface.
async function waitForFileMtimeChange(
  filePath: string,
  originalMtime: number | null,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { mtimeMs } = await stat(filePath);
      if (originalMtime === null || mtimeMs > originalMtime) {
        return true;
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function createUser(baseUrl: string, email: string): Promise<void> {
  const response = await fetch(`${baseUrl}/?index`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email }).toString(),
    redirect: 'follow',
  });
  expect(response.ok).toBe(true);
}

describe('react-router-demo smoke (e2e)', () => {
  let dev: DevDatabase | null = null;
  let server: ViteDevServer | null = null;
  let originalSchema: string | null = null;
  let schemaBaseline: string | null = null;
  let contractJsonBaseline: Buffer | null = null;

  beforeEach(async () => {
    // Capture byte-equal baselines for both checked-in artifacts so afterEach
    // can assert that the test's mutations were fully reverted. AC10 requires
    // the working tree to stay clean after teardown; sequencing alone is not
    // enough — a future regression in the wait-for-re-emit step, or any new
    // mid-test file write that forgets to revert, would leave the tree dirty
    // without detection unless this invariant is checked at the end of each
    // test.
    schemaBaseline = await readFile(schemaPath, 'utf-8');
    contractJsonBaseline = await readFile(contractJsonPath);
    originalSchema = schemaBaseline;
    dev = await createDevDatabase();
    await withClient(dev.connectionString, async (client) => {
      await client.query(TEST_SCHEMA_SQL);
    });
    vi.stubEnv('DATABASE_URL', dev.connectionString);
    // @prisma/dev (PGlite) rejects concurrent connections; cap the example's
    // pg pool at 1 only here so the production code path stays unconstrained.
    vi.stubEnv('REACT_ROUTER_DEMO_PG_POOL_MAX', '1');
  });

  afterEach(async () => {
    // Revert the schema first so the still-running plugin re-emits clean
    // artifacts, then close the server so nothing is left mid-flight, then tear
    // down the dev database and unstub the env.
    if (originalSchema !== null) {
      let preRevertMtime: number | null = null;
      try {
        preRevertMtime = (await stat(contractJsonPath)).mtimeMs;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      await writeFile(schemaPath, originalSchema);
      originalSchema = null;
      if (server) {
        await waitForFileMtimeChange(
          contractJsonPath,
          preRevertMtime,
          timeouts.typeScriptCompilation,
        );
      }
    }
    if (server) {
      await server.close();
      server = null;
    }
    if (dev) {
      await dev.close();
      dev = null;
    }
    vi.unstubAllEnvs();

    // Assert AC10's working-tree-clean invariant after teardown completes.
    // Read fresh from disk (not the closure-captured baselines) so we observe
    // the actual on-disk state the next test (or `git status`) would see.
    if (schemaBaseline !== null && contractJsonBaseline !== null) {
      const finalSchema = await readFile(schemaPath, 'utf-8');
      const finalContractJson = await readFile(contractJsonPath);
      expect(finalSchema).toBe(schemaBaseline);
      expect(finalContractJson.equals(contractJsonBaseline)).toBe(true);
      schemaBaseline = null;
      contractJsonBaseline = null;
    }
  });

  it(
    're-emits contract on PSL edit and serves requests through the framework runtime',
    async () => {
      // Capture `contract.json`'s mtime *before* `createServer()` so the
      // startup re-emit assertion can't be silently satisfied by the stale
      // committed artifact. The Vite plugin's `configureServer` hook (which
      // runs the initial emit via `requestEmit({ refreshWatchedFiles: false })`)
      // is awaited inside `createServer()` itself, so any read after the
      // `await createServer()` already reflects the post-emit mtime. Treat
      // ENOENT as a pre-boot null baseline so a future change that stops
      // committing the artifact still works.
      let preBootMtime: number | null = null;
      try {
        preBootMtime = (await stat(contractJsonPath)).mtimeMs;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error;
        }
      }

      server = await createServer({
        root: exampleDir,
        mode: 'development',
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });
      await server.listen();

      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') {
        throw new Error('expected HTTP server to bind to a TCP address');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const initialEmit = await waitForFileMtimeChange(
        contractJsonPath,
        preBootMtime,
        timeouts.typeScriptCompilation,
      );
      expect(initialEmit).toBe(true);

      const initialMtime = (await stat(contractJsonPath)).mtimeMs;

      if (dev === null) {
        throw new Error('beforeEach must have created a dev database before the test body runs');
      }
      await withClient(dev.connectionString, async (client) => {
        await client.query(
          'insert into "user" (email, "createdAt") values ($1, now() - interval \'1 hour\')',
          ['alice@example.com'],
        );
      });
      await createUser(baseUrl, 'bob@example.com');

      const listResponse = await fetch(`${baseUrl}/`);
      expect(listResponse.ok).toBe(true);
      const listBody = await listResponse.text();
      expect(listBody).toContain('alice@example.com');
      expect(listBody.indexOf('bob@example.com')).toBeLessThan(
        listBody.indexOf('alice@example.com'),
      );

      if (originalSchema === null) {
        throw new Error('beforeEach must have captured originalSchema before the test body runs');
      }
      const editedSchema = originalSchema.replace(
        '  email     String\n',
        '  email     String\n  nickname  String?\n',
      );
      // Guard against schema reformats silently breaking the test.
      expect(editedSchema).not.toBe(originalSchema);
      await writeFile(schemaPath, editedSchema);

      const reEmit = await waitForFileMtimeChange(
        contractJsonPath,
        initialMtime,
        timeouts.typeScriptCompilation,
      );
      expect(reEmit).toBe(true);

      const updatedContract: unknown = JSON.parse(await readFile(contractJsonPath, 'utf-8'));
      expect(updatedContract).toMatchObject({
        storage: {
          namespaces: {
            public: {
              entries: {
                table: {
                  user: {
                    columns: { nickname: expect.anything() },
                  },
                },
              },
            },
          },
        },
      });

      // Pull a fresh `db.server` module via Vite's SSR module loader to prove
      // that the framework runtime — not just the on-disk artifact — sees the
      // newly emitted column. If the HMR dispose handler stopped invalidating
      // the cached runtime (or the plugin failed to invalidate `db.server.ts`
      // when `contract.json` changed), the module would still hold a reference
      // to a stale `contract.json` and `select('nickname')` would synchronously
      // throw `Column "nickname" not found in scope` from the SQL builder.
      // ssrLoadModule's typed return is `Record<string, any>`; cast once to
      // the narrow shape we exercise here so the rest of the test stays typed.
      const freshModule = (await server.ssrLoadModule('/app/lib/db.server.ts')) as unknown as {
        getDb: () => {
          sql: {
            public: {
              user: {
                select(...columns: readonly string[]): { build(): unknown };
              };
            };
          };
        };
      };
      const freshDb = freshModule.getDb();
      expect(() => freshDb.sql.public.user.select('id', 'email', 'nickname').build()).not.toThrow();

      const followUpResponse = await fetch(`${baseUrl}/`);
      expect(followUpResponse.ok).toBe(true);
    },
    timeouts.spinUpPpgDev,
  );
});
