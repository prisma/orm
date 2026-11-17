import type { PostgresControlDriver } from '@internal/driver-postgres/control';
import { expect } from 'vitest';

/**
 * Asserts that no marker or ledger writes have occurred in the database.
 * Checks if the prisma_contract.marker and prisma_contract.ledger tables exist,
 * and if so, verifies they contain zero rows.
 */
export async function expectNoMarkerOrLedgerWrites(driver: PostgresControlDriver): Promise<void> {
  const markerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('prisma_contract.marker') is not null as exists`,
  );
  const ledgerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('prisma_contract.ledger') is not null as exists`,
  );

  if (markerTableExists.rows[0]?.exists) {
    const markerCount = await driver.query<{ count: string }>(
      'select count(*)::text as count from prisma_contract.marker',
    );
    expect(markerCount.rows[0]?.count ?? '0').toBe('0');
  }

  if (ledgerTableExists.rows[0]?.exists) {
    const ledgerCount = await driver.query<{ count: string }>(
      'select count(*)::text as count from prisma_contract.ledger',
    );
    expect(ledgerCount.rows[0]?.count ?? '0').toBe('0');
  }
}
