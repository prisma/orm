import { inCi } from '@repo/test-utils/ci';
import { mysqlServerUrl } from '@repo/test-utils/mysql-database';
import { expect, it } from 'vitest';

it.runIf(inCi)(
  'has the MySQL and MariaDB servers its live tests run against when it runs in CI',
  () => {
    expect(
      { mysql: mysqlServerUrl('MYSQL_URL'), mariadb: mysqlServerUrl('MARIADB_URL') },
      'MYSQL_URL or MARIADB_URL is not set, so the live tests skipped',
    ).toEqual({ mysql: expect.any(String), mariadb: expect.any(String) });
  },
);
