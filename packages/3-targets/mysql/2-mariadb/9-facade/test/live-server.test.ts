import { inCi, mysqlServerUrl } from '@repo/test-utils/mysql-database';
import { expect, it } from 'vitest';

it.runIf(inCi)('has the MariaDB server its live tests run against when it runs in CI', () => {
  expect(
    mysqlServerUrl('MARIADB_URL'),
    'MARIADB_URL is not set, so the live tests skipped',
  ).toBeDefined();
});
