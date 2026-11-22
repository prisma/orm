import { randomBytes } from 'node:crypto';
import mysqlControlDriver from '@prisma/orm-mysql/driver/control';

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

/** The URL of the MySQL server the tests run against, from `MYSQL_URL`. Throws, saying how to start the server, when it is not set. */
function requireServerUrl(): string {
  const url = process.env['MYSQL_URL'];
  if (url !== undefined && url.length > 0) return url;
  throw new Error(
    'MYSQL_URL is not set. These tests need a MySQL server: run `docker compose up -d --wait mysql` at the repository root and set MYSQL_URL="mysql://root:root@127.0.0.1:3307/?allowPublicKeyRetrieval=true".',
  );
}

/** Creates an empty, uniquely named database on the server at `MYSQL_URL` and returns its connection URL. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const server = requireServerUrl();
  const name = `prisma_8_demo_mysql_${randomBytes(6).toString('hex')}`;
  await runOnServer(server, `CREATE DATABASE \`${name}\``);
  const url = new URL(server);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: () => runOnServer(server, `DROP DATABASE IF EXISTS \`${name}\``),
  };
}

/** Runs one statement through the MySQL control driver, which reads `serverUrl` as the CLI does, TLS settings included. */
async function runOnServer(serverUrl: string, statement: string): Promise<void> {
  const driver = await mysqlControlDriver.create(serverUrl);
  try {
    await driver.query(statement);
  } finally {
    await driver.close();
  }
}
