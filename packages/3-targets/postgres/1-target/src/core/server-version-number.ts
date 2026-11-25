import type { SqlControlDriverInstance } from '@internal/sql-contract/types';

const SERVER_VERSION_NUMBER_SQL =
  "SELECT current_setting('server_version_num')::int AS server_version_num";

function versionNumberOf(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : undefined;
}

/** The server's `server_version_num`, such as `150004` for PostgreSQL 15.4, or `undefined` when the database does not report one. A driver may return the integer as a number or as its text. */
export async function readPostgresServerVersionNumber(
  driver: SqlControlDriverInstance<string>,
): Promise<number | undefined> {
  const result = await driver.query<{ server_version_num: unknown }>(SERVER_VERSION_NUMBER_SQL, []);
  return versionNumberOf(result.rows[0]?.server_version_num);
}
