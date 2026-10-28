import { randomBytes } from 'node:crypto';
import { ifDefined } from '@internal/utils/defined';
import { type ConnectionConfig, createConnection } from 'mariadb';

/** A MySQL database created for one test. */
export interface MysqlTestDatabase {
  /** The database's name, unique to this test. */
  readonly name: string;
  /** `MYSQL_URL` with this database as its path. */
  readonly url: string;
}

/** What a vitest test context offers to skip the test. */
interface SkippableTest {
  skip(note?: string): void;
}

/** The URL of the MySQL server tests run against, from `MYSQL_URL`, or `undefined` when it is not set. */
export function mysqlServerUrl(): string | undefined {
  const url = process.env['MYSQL_URL'];
  return url === undefined || url.length === 0 ? undefined : url;
}

function textField(value: object, key: string): string | undefined {
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' ? field : undefined;
}

/** The TLS settings of the URL's `ssl` parameter: `true`, `false` or a JSON object, read as the MySQL driver reads them. */
function tlsOptions(text: string | null): ConnectionConfig['ssl'] {
  if (text === null) return undefined;
  const value: unknown = JSON.parse(text);
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object' || value === null) {
    throw new Error('The ssl parameter of MYSQL_URL must be true, false or a JSON object');
  }
  const rejectUnauthorized: unknown = Reflect.get(value, 'rejectUnauthorized');
  return {
    ...ifDefined('ca', textField(value, 'ca')),
    ...ifDefined('cert', textField(value, 'cert')),
    ...ifDefined('key', textField(value, 'key')),
    ...ifDefined('passphrase', textField(value, 'passphrase')),
    ...ifDefined('servername', textField(value, 'servername')),
    ...(typeof rejectUnauthorized === 'boolean' ? { rejectUnauthorized } : {}),
  };
}

/**
 * Connection options for the server a `mysql://` URL names, with its `ssl` and `allowPublicKeyRetrieval` parameters; the `mariadb` package reads only `mariadb://` URLs. The MySQL control driver reads the URL the same way, but this package cannot depend on it: the driver's tests depend on this package.
 */
function serverOptions(serverUrl: string): ConnectionConfig {
  const url = new URL(serverUrl);
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    ...(url.port === '' ? {} : { port: Number(url.port) }),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...ifDefined('ssl', tlsOptions(url.searchParams.get('ssl'))),
    allowPublicKeyRetrieval: url.searchParams.get('allowPublicKeyRetrieval') === 'true',
  };
}

function uniqueDatabaseName(): string {
  return `prisma_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

/**
 * Runs `fn` with a database of its own on the MySQL server `MYSQL_URL` names, and drops the database afterwards. Skips the test when `MYSQL_URL` is not set. Each call creates a database with a unique name, so tests that share a server, as CI shards do, never see each other's tables. When the test fails, a failure to drop the database does not replace the test's error.
 */
export async function withMysqlDatabase<T>(
  test: SkippableTest,
  fn: (database: MysqlTestDatabase) => Promise<T>,
): Promise<T | undefined> {
  const serverUrl = mysqlServerUrl();
  if (serverUrl === undefined) {
    test.skip('MYSQL_URL is not set');
    return undefined;
  }
  const name = uniqueDatabaseName();
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const admin = await createConnection(serverOptions(serverUrl));
  try {
    await admin.query(`CREATE DATABASE \`${name}\``);
    let testFailed = false;
    try {
      return await fn({ name, url: url.toString() });
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``).catch((dropError: unknown) => {
        if (!testFailed) throw dropError;
      });
    }
  } finally {
    await admin.end();
  }
}
