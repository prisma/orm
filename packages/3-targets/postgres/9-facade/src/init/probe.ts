import type { InitProbeResult } from '@internal/cli/init-contribution';

/** The server answered, but not with a version this probe can read; init reports it as a failed probe. */
class ServerVersionUnreadable extends Error {
  override readonly name = 'ServerVersionUnreadable';
}

/**
 * Extracts the numeric prefix from a Postgres `version()` row, e.g.
 *
 *   `PostgreSQL 14.10 on x86_64-pc-linux-gnu, ...`  → `"14.10"`
 *   `PostgreSQL 16beta1 on …`                       → `"16"` (we
 *      conservatively drop the suffix; minimum-version comparisons
 *      treat 16beta1 as 16, which is what every reasonable user
 *      expects).
 */
export function parsePostgresVersion(versionString: string): string {
  const match = versionString.match(/PostgreSQL\s+(\d+(?:\.\d+)?)/i);
  if (match === null || match[1] === undefined) {
    throw new ServerVersionUnreadable(
      `Could not parse PostgreSQL version from \`${versionString}\``,
    );
  }
  return match[1];
}

export async function probePostgres(databaseUrl: string): Promise<InitProbeResult> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: databaseUrl });
  client.on('error', () => {});
  try {
    await client.connect();
    const result = await client.query<{ version: string }>('SELECT version() as version');
    const versionString = String(result.rows[0]?.version ?? '');
    return { kind: 'server-version', serverVersion: parsePostgresVersion(versionString) };
  } finally {
    await client.end().catch(() => undefined);
  }
}
