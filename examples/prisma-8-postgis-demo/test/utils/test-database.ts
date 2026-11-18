/**
 * Test database utilities — talks to the PostgreSQL+PostGIS instance
 * defined in `docker-compose.yml`. The e2e suite skips entirely when the
 * server isn't reachable so a clean clone of the repo doesn't fail
 * unexpectedly; you opt in by running `pnpm db:up`.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgis from '@prisma/orm-extension-postgis/control';
import { type ControlClient, createPostgresControlClient } from '@prisma/orm-postgres/control';
import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5435/postgis_demo';

/**
 * Whitelist guard for `resetTestDatabase`. We drop and recreate the
 * `public` schema, so a misconfigured `DATABASE_URL` pointing at
 * something non-test would be catastrophic. Accept the demo's default
 * database name or anything ending in `_test`.
 */
function assertTestDatabaseUrl(url: string): void {
  let databaseName: string;
  try {
    const parsed = new URL(url);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error(
      'resetTestDatabase: TEST_DATABASE_URL is not a valid URL. Refusing to run destructive setup against an unknown target.',
    );
  }
  if (!databaseName) {
    throw new Error(
      'resetTestDatabase: TEST_DATABASE_URL has no database name. Refusing to run destructive setup against an unknown target.',
    );
  }
  if (databaseName !== 'postgis_demo' && !databaseName.endsWith('_test')) {
    throw new Error(
      `resetTestDatabase: refusing to drop schemas on database '${databaseName}'. Set TEST_DATABASE_URL to a database named 'postgis_demo' or one whose name ends with '_test'.`,
    );
  }
}

/**
 * Probe the test database. Returns true only if the connection succeeds
 * AND the postgis extension is available. We use this to gate the
 * integration suite so missing-Docker is a skip, not a failure.
 */
export async function isPostgisAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: TEST_DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM pg_available_extensions WHERE name = 'postgis'",
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function createPostgisControlClient(connection: string): ControlClient {
  return createPostgresControlClient({
    connection,
    extensions: [postgis],
  });
}

/**
 * Project root resolved from this file's location: `<root>/test/utils/`.
 */
const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * The demo's on-disk `migrations/` directory. Contains both the user-owned
 * `app/` space and the planned `postgis/` extension space (materialised
 * by `pnpm exec prisma migration plan`).
 *
 * `db init` requires this directory to exist with the extension space
 * already planned in; see Linear TML-2495 for the gotcha. Tests fail
 * early with a clear message rather than the cryptic
 * `MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION [declaredButUnmigrated] postgis` when the prerequisite
 * step is missing.
 */
const MIGRATIONS_DIR = join(PROJECT_ROOT, 'migrations');

/**
 * Drop+recreate the public schema, then run `dbInit` to apply the contract
 * (which also installs the postgis extension via the planned baseline
 * migration under `migrations/postgis/`).
 */
export async function resetTestDatabase(contract: unknown): Promise<void> {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  } finally {
    await client.end();
  }

  const controlClient = createPostgisControlClient(TEST_DATABASE_URL);
  try {
    const result = await controlClient.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract,
      mode: 'apply',
      migrationsDir: MIGRATIONS_DIR,
    });
    if (!result.ok) {
      throw new Error(
        `dbInit failed: ${result.failure.message}\n\nDid you run \`pnpm exec prisma migration plan\` before \`pnpm test\`? (See Linear TML-2495.)\n\n${JSON.stringify(result.failure, null, 2)}`,
      );
    }
  } finally {
    await controlClient.close();
  }
}
