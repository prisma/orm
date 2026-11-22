import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireMysqlServerUrl, withMysqlDatabase } from '../src/mysql-database';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the server variable of withMysqlDatabase', () => {
  it('is MYSQL_URL unless the caller names another', () => {
    vi.stubEnv('MYSQL_URL', 'mysql://root@mysql-host/');
    vi.stubEnv('MARIADB_URL', 'mysql://root@mariadb-host/');
    expect([requireMysqlServerUrl(), requireMysqlServerUrl('MARIADB_URL')]).toEqual([
      'mysql://root@mysql-host/',
      'mysql://root@mariadb-host/',
    ]);
  });

  it('fails the test, saying how to start MySQL, when MYSQL_URL is not set', async () => {
    vi.stubEnv('MYSQL_URL', '');
    await expect(withMysqlDatabase(async () => 'ran')).rejects.toThrow(
      'MYSQL_URL is not set. These tests need a MySQL server: run `docker compose up -d mysql` at the repository root and set MYSQL_URL="mysql://root:root@127.0.0.1:3307/?allowPublicKeyRetrieval=true".',
    );
  });

  it('fails the test, saying how to start MariaDB, when MARIADB_URL is not set', async () => {
    vi.stubEnv('MYSQL_URL', 'mysql://root@mysql-host/');
    vi.stubEnv('MARIADB_URL', '');
    await expect(withMysqlDatabase(async () => 'ran', 'MARIADB_URL')).rejects.toThrow(
      'MARIADB_URL is not set. These tests need a MariaDB server: run `docker compose up -d mariadb` at the repository root and set MARIADB_URL="mysql://root@127.0.0.1:3308/".',
    );
  });
});
