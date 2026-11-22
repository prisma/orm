import { randomBytes } from 'node:crypto';
import mariadbControlDriver from '@prisma/orm-mariadb/driver/control';

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

/** The URL of the MariaDB server the tests run against, from `MARIADB_URL`. Throws, saying how to start the server, when it is not set. */
function requireServerUrl(): string {
  const url = process.env['MARIADB_URL'];
  if (url !== undefined && url.length > 0) return url;
  throw new Error(
    'MARIADB_URL is not set. These tests need a MariaDB server: run `docker compose up -d mariadb` at the repository root and set MARIADB_URL="mysql://root@127.0.0.1:3308/".',
  );
}

/** Creates an empty, uniquely named database on the server at `MARIADB_URL` and returns its connection URL. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const server = requireServerUrl();
  const name = `prisma_8_demo_mariadb_${randomBytes(6).toString('hex')}`;
  await runOnServer(server, `CREATE DATABASE \`${name}\``);
  const url = new URL(server);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: () => runOnServer(server, `DROP DATABASE IF EXISTS \`${name}\``),
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
