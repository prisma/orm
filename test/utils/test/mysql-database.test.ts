import { createConnection } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { mysqlServerUrl, withMysqlDatabase } from '../src/mysql-database';
import { timeouts } from '../src/timeouts';

async function asAdmin<T>(
  serverUrl: string,
  fn: (run: (sql: string) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const url = new URL(serverUrl);
  const connection = await createConnection({
    host: url.hostname,
    ...(url.port === '' ? {} : { port: Number(url.port) }),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    allowPublicKeyRetrieval: url.searchParams.get('allowPublicKeyRetrieval') === 'true',
  });
  try {
    return await fn((sql) => connection.query(sql));
  } finally {
    await connection.end();
  }
}

describe('withMysqlDatabase', () => {
  it(
    'reaches a server that requires TLS when MYSQL_URL carries the TLS parameters the MySQL driver reads',
    async (test) => {
      const serverUrl = mysqlServerUrl();
      if (serverUrl === undefined) {
        test.skip('MYSQL_URL is not set');
        return;
      }
      const user = `tls_${Date.now().toString(36)}`;
      await asAdmin(serverUrl, async (run) => {
        await run(`CREATE USER '${user}'@'%' IDENTIFIED BY 'pw-tls' REQUIRE SSL`);
        await run(`GRANT CREATE, DROP ON *.* TO '${user}'@'%'`);
        const tlsUrl = new URL(serverUrl);
        tlsUrl.username = user;
        tlsUrl.password = 'pw-tls';
        tlsUrl.searchParams.delete('allowPublicKeyRetrieval');
        tlsUrl.searchParams.set('sslmode', 'no-verify');
        process.env['MYSQL_URL'] = tlsUrl.toString();
        try {
          const created = await withMysqlDatabase(test, async ({ name, url }) => ({
            name,
            sslmode: new URL(url).searchParams.get('sslmode'),
          }));
          expect(created).toEqual({
            name: expect.stringMatching(/^prisma_test_/),
            sslmode: 'no-verify',
          });
        } finally {
          process.env['MYSQL_URL'] = serverUrl;
          await run(`DROP USER IF EXISTS '${user}'@'%'`);
        }
      });
    },
    timeouts.databaseOperation,
  );
});
