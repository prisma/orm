import { randomBytes } from 'node:crypto';
import mariadbControlDriver from '@prisma/orm-mariadb/driver/control';

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

/**
 * The URL of the MariaDB server the tests run against, from `MARIADB_URL`, or `undefined` when it is not set. In CI a missing `MARIADB_URL` throws, so the tests fail instead of skipping.
 */
export function mariadbServerUrl(): string | undefined {
  const url = process.env['MARIADB_URL'];
  if (url !== undefined && url.length > 0) return url;
  if (process.env['CI'] !== undefined) {
    throw new Error('MARIADB_URL is not set; CI runs these tests against a MariaDB server');
  }
  return undefined;
}

/**
 * Creates an empty, uniquely named database on the server at `serverUrl` and
 * returns its connection URL.
 */
export async function createTestDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `prisma_8_demo_mariadb_${randomBytes(6).toString('hex')}`;
  await runOnServer(serverUrl, `CREATE DATABASE \`${name}\``);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: () => runOnServer(serverUrl, `DROP DATABASE IF EXISTS \`${name}\``),
  };
}

/** Runs one statement through the MariaDB control driver, which reads `serverUrl` as the CLI does, TLS settings included. */
async function runOnServer(serverUrl: string, statement: string): Promise<void> {
  const driver = await mariadbControlDriver.create(serverUrl);
  try {
    await driver.query(statement);
  } finally {
    await driver.close();
  }
}
