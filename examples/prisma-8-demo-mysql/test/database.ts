import { randomBytes } from 'node:crypto';
import mysqlControlDriver from '@prisma/orm-mysql/driver/control';

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

/**
 * Creates an empty, uniquely named database on the server at `serverUrl` and
 * returns its connection URL.
 */
export async function createTestDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `prisma_8_demo_mysql_${randomBytes(6).toString('hex')}`;
  await runOnServer(serverUrl, `CREATE DATABASE \`${name}\``);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: () => runOnServer(serverUrl, `DROP DATABASE IF EXISTS \`${name}\``),
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
