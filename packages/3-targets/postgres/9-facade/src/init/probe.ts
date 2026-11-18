import type { InitProbeResult } from '@internal/cli/init-contribution';
import type pgDriver from 'pg';
import type { QueryConfig } from 'pg';

/**
 * Extracts the numeric prefix from a Postgres `version()` row, e.g.
 *
 *   `PostgreSQL 14.10 on x86_64-pc-linux-gnu, ...`  → `"14.10"`
 *   `PostgreSQL 16beta1 on …`                       → `"16"` (we
 *      conservatively drop the suffix; minimum-version comparisons
 *      treat 16beta1 as 16, which is what every reasonable user
 *      expects).
 *
 * `undefined` when the row holds no PostgreSQL version.
 */
export function parsePostgresVersion(versionString: string): string | undefined {
  return versionString.match(/PostgreSQL\s+(\d+(?:\.\d+)?)/i)?.[1];
}

/** How long the probe waits for the server to accept the connection, and then to answer. */
const PROBE_TIMEOUT_MILLIS = 20_000;

type LoadDriver = () => Promise<{ readonly default: typeof pgDriver }>;

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ERR_MODULE_NOT_FOUND';
}

export async function probePostgres(
  databaseUrl: string,
  signal: AbortSignal,
  loadDriver: LoadDriver = () => import('pg'),
): Promise<InitProbeResult> {
  let pg: { readonly default: typeof pgDriver };
  try {
    pg = await loadDriver();
  } catch (error) {
    return {
      kind: isModuleNotFound(error) ? 'driver-missing' : 'driver-failed',
      driver: 'pg',
      cause: causeMessage(error),
    };
  }
  const client = new pg.default.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: PROBE_TIMEOUT_MILLIS,
    query_timeout: PROBE_TIMEOUT_MILLIS,
  });
  client.on('error', () => {});
  const endOnAbort = (): void => {
    void client.end().catch(() => undefined);
  };
  signal.addEventListener('abort', endOnAbort, { once: true });
  try {
    await client.connect();
    // pg reads query_timeout from a query's config as well, where the URL cannot override it.
    const versionQuery: QueryConfig & { readonly query_timeout: number } = {
      text: 'SELECT version() as version',
      query_timeout: PROBE_TIMEOUT_MILLIS,
    };
    let result: pgDriver.QueryResult<{ version: string }>;
    try {
      result = await client.query<{ version: string }>(versionQuery);
    } catch (error) {
      return {
        kind: 'version-unreadable',
        detail: `SELECT version() failed: ${causeMessage(error)}`,
      };
    }
    const versionString = String(result.rows[0]?.version ?? '');
    const serverVersion = parsePostgresVersion(versionString);
    return serverVersion === undefined
      ? {
          kind: 'version-unreadable',
          detail: `could not parse PostgreSQL version from \`${versionString}\``,
        }
      : { kind: 'server-version', serverVersion };
  } finally {
    signal.removeEventListener('abort', endOnAbort);
    await client.end().catch(() => undefined);
  }
}
