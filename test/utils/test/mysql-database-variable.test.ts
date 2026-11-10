import { afterEach, describe, expect, it, vi } from 'vitest';
import { mysqlServerUrl, withMysqlDatabase } from '../src/mysql-database';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the server variable of withMysqlDatabase', () => {
  it('is MYSQL_URL unless the caller names another', () => {
    vi.stubEnv('MYSQL_URL', 'mysql://root@mysql-host/');
    vi.stubEnv('MARIADB_URL', 'mysql://root@mariadb-host/');
    expect([mysqlServerUrl(), mysqlServerUrl('MARIADB_URL')]).toEqual([
      'mysql://root@mysql-host/',
      'mysql://root@mariadb-host/',
    ]);
  });

  it('skips the test, naming the variable, when the variable the caller names is not set', async () => {
    vi.stubEnv('MYSQL_URL', 'mysql://root@mysql-host/');
    vi.stubEnv('MARIADB_URL', '');
    const skipped: (string | undefined)[] = [];
    const ran = await withMysqlDatabase(
      { skip: (note) => skipped.push(note) },
      async () => 'ran',
      'MARIADB_URL',
    );
    expect({ ran, skipped }).toEqual({ ran: undefined, skipped: ['MARIADB_URL is not set'] });
  });
});
