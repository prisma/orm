import { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
import { type ServerOptions, startPrismaDevServer } from '@prisma/dev';
import { Client } from 'pg';

export * from '../application-domain-of';
export * from '../column-descriptors';
export * from '../contract-factories';
export * from '../lowered-params';
export * from '../operation-descriptors';
export * from '../timeouts';

function normalizeConnectionString(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

export interface DevDatabase {
  readonly connectionString: string;
  /** How long the server keeps an idle connection open before closing it. */
  readonly databaseIdleTimeoutMillis: number;
  close(): Promise<void>;
}

/**
 * The Postgres driver's pool keeps an idle client for 30 s. The dev server must
 * not close a connection sooner, or the pool hands a test a dead client the
 * first time it pauses between queries — which a slow or coverage-instrumented
 * run does routinely.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 * @prisma/dev automatically assigns ports to avoid conflicts and enforces a single
 * active connection (second connections are rejected until the first is closed).
 */
export async function createDevDatabase(options?: ServerOptions): Promise<DevDatabase> {
  const settings = {
    databaseConnectTimeoutMillis: 1000,
    databaseIdleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    ...options,
  };
  const server = await startPrismaDevServer(settings);
  return {
    ...server,
    databaseIdleTimeoutMillis: settings.databaseIdleTimeoutMillis,
    connectionString: normalizeConnectionString(server.database.connectionString),
  };
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 * @prisma/dev automatically assigns ports and will reject any attempt to open a
 * second connection while the first is active, so ensure each helper call closes
 * before starting another.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: ServerOptions,
): Promise<T> {
  const database = await createDevDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Executes a function with a database client, automatically cleaning up afterward.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  // A PGlite (WASM) dev server can abort mid-operation on the slower CI
  // runners; the suppressed connection-level 'error' event would otherwise
  // fail the whole run even though the awaited query already rejected and the
  // test is retried on a fresh database.
  const client = suppressIdleConnectionErrors(new Client({ connectionString }));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    // On a dropped connection `end()` itself can reject; the caller already has
    // the real failure from `fn`, so don't let cleanup mask or replace it.
    await client.end().catch(() => {});
  }
}

/**
 * Drains an async iterable, consuming all values without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

/**
 * Collects all values from an async iterable into an array.
 * Useful for testing query results.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

/**
 * Tears down test database by dropping schema and tables.
 * This helper DRYs up the common pattern of database teardown in tests.
 */
export async function teardownTestDatabase(client: Client, tables?: string[]): Promise<void> {
  if (tables && tables.length > 0) {
    for (const table of tables) {
      await client.query(`drop table if exists "${table}"`);
    }
  }
  await client.query('drop schema if exists prisma_contract cascade');
}
