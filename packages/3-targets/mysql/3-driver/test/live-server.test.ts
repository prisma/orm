import { mysqlServerUrl } from '@repo/test-utils/mysql-database';
import { expect, it } from 'vitest';

it.runIf(process.env['CI'] !== undefined)(
  'has the MySQL server its live tests run against when it runs in CI',
  () => {
    expect(
      mysqlServerUrl('MYSQL_URL'),
      'MYSQL_URL is not set, so the live tests skipped',
    ).toBeDefined();
  },
);
