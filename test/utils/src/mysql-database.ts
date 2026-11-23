import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ifDefined } from '@internal/utils/defined';
import { type ConnectionConfig, createConnection } from 'mariadb';

/** A MySQL database created for one test. */
export interface MysqlTestDatabase {
  /** The database's name, unique to this test. */
  readonly name: string;
  /** The server's URL with this database as its path. */
  readonly url: string;
}

const servers = {
  MYSQL_URL: {
    name: 'MySQL',
    service: 'mysql',
    url: 'mysql://root:root@127.0.0.1:3307/?allowPublicKeyRetrieval=true',
  },
  MARIADB_URL: { name: 'MariaDB', service: 'mariadb', url: 'mysql://root@127.0.0.1:3308/' },
} as const;

/** An environment variable that names the MySQL or MariaDB server tests run against. */
export type MysqlServerVariable = keyof typeof servers;

/** The URL of the server the environment variable `variable` names, `MYSQL_URL` unless given. Throws, saying how to start the server, when the variable is not set. */
export function requireMysqlServerUrl(variable: MysqlServerVariable = 'MYSQL_URL'): string {
  const url = process.env[variable];
  if (url !== undefined && url.length > 0) return url;
  const server = servers[variable];
  throw new Error(
    `${variable} is not set. These tests need a ${server.name} server: run \`docker compose up -d --wait ${server.service}\` at the repository root and set ${variable}="${server.url}".`,
  );
}

/**
 * The TLS settings of the URL, read as the MySQL driver reads them, which is as `pg-connection-string` reads them for Postgres: `ssl` turns TLS on or off; `sslmode`, `sslcert`, `sslkey` or `sslrootcert` turn it on, the last three naming PEM files; `sslmode=disable` turns it off and `no-verify` accepts any certificate.
 */
function tlsOptions(url: URL): ConnectionConfig['ssl'] {
  const parameter = (name: string) => url.searchParams.get(name) ?? undefined;
  const sslmode = parameter('sslmode');
  const files = {
    cert: parameter('sslcert'),
    key: parameter('sslkey'),
    ca: parameter('sslrootcert'),
  };
  if (sslmode === undefined && Object.values(files).every((path) => path === undefined)) {
    const ssl = parameter('ssl');
    return ssl === undefined ? undefined : ssl === 'true' || ssl === '1';
  }
  if (sslmode === 'disable') return false;
  return {
    ...ifDefined('cert', files.cert === undefined ? undefined : readFileSync(files.cert, 'utf8')),
    ...ifDefined('key', files.key === undefined ? undefined : readFileSync(files.key, 'utf8')),
    ...ifDefined('ca', files.ca === undefined ? undefined : readFileSync(files.ca, 'utf8')),
    ...(sslmode === 'no-verify' ? { rejectUnauthorized: false } : {}),
  };
}

/**
 * Connection options for the server a `mysql://` URL names, with its TLS and `allowPublicKeyRetrieval` parameters; the `mariadb` package reads only `mariadb://` URLs. The MySQL control driver reads the URL the same way, but this package cannot depend on it: the driver's tests depend on this package.
 */
function serverOptions(serverUrl: string): ConnectionConfig {
  const url = new URL(serverUrl);
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    ...(url.port === '' ? {} : { port: Number(url.port) }),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...ifDefined('ssl', tlsOptions(url)),
    allowPublicKeyRetrieval: url.searchParams.get('allowPublicKeyRetrieval') === 'true',
  };
}

function uniqueDatabaseName(): string {
  return `prisma_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

/**
 * Runs `fn` with a database of its own on the server the environment variable `variable` names, `MYSQL_URL` unless given, and drops the database afterwards. Throws when the variable is not set. Each call creates a database with a unique name, so tests that share a server, as CI shards do, never see each other's tables. When the test fails, a failure to drop the database does not replace the test's error.
 */
export async function withMysqlDatabase<T>(
  fn: (database: MysqlTestDatabase) => Promise<T>,
  variable: MysqlServerVariable = 'MYSQL_URL',
): Promise<T> {
  const serverUrl = requireMysqlServerUrl(variable);
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

/** Runs `sql` on the MySQL database `url` names, on a connection of its own. */
export async function queryMysqlDatabase(url: string, sql: string): Promise<void> {
  const connection = await createConnection({
    ...serverOptions(url),
    database: decodeURIComponent(new URL(url).pathname.slice(1)),
  });
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}
