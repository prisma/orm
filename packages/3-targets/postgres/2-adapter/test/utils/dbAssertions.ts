import type { PostgresControlDriver } from '@internal/driver-postgres/control';
import { expect } from 'vitest';

/**
 * Asserts that no marker or ledger writes have occurred in the database, other than the rows of the
 * `_prisma` contract space that created the tables.
 */
export async function expectNoMarkerOrLedgerWrites(driver: PostgresControlDriver): Promise<void> {
  const markerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('_prisma.marker') is not null as exists`,
  );
  const ledgerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('_prisma.ledger') is not null as exists`,
  );

  if (markerTableExists.rows[0]?.exists) {
    const markerCount = await driver.query<{ count: string }>(
      "select count(*)::text as count from _prisma.marker where space <> '_prisma'",
    );
    expect(markerCount.rows[0]?.count ?? '0').toBe('0');
  }

  if (ledgerTableExists.rows[0]?.exists) {
    const ledgerCount = await driver.query<{ count: string }>(
      "select count(*)::text as count from _prisma.ledger where space <> '_prisma'",
    );
    expect(ledgerCount.rows[0]?.count ?? '0').toBe('0');
  }
}
