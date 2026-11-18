import type { InitProbeResult } from '@internal/cli/init-contribution';

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

export async function probePostgres(databaseUrl: string): Promise<InitProbeResult> {
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: PROBE_TIMEOUT_MILLIS,
    query_timeout: PROBE_TIMEOUT_MILLIS,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const result = await client.query<{ version: string }>('SELECT version() as version');
    const versionString = String(result.rows[0]?.version ?? '');
    const serverVersion = parsePostgresVersion(versionString);
    return serverVersion === undefined
      ? {
          kind: 'version-unreadable',
          detail: `could not parse PostgreSQL version from \`${versionString}\``,
        }
      : { kind: 'server-version', serverVersion };
  } finally {
    await client.end().catch(() => undefined);
  }
}
