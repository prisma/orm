import type { PostgresControlDriver } from '@internal/driver-postgres/control';
import { expect } from 'vitest';

/**
 * Asserts that no signature or ledger writes have occurred in the database, other than the rows of the
 * `_prisma` contract space that created the tables.
 */
export async function expectNoMarkerOrLedgerWrites(driver: PostgresControlDriver): Promise<void> {
  const signaturesTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('_prisma.signatures') is not null as exists`,
  );
  const ledgerTableExists = await driver.query<{ exists: boolean }>(
    `select to_regclass('_prisma.ledger') is not null as exists`,
  );

  if (signaturesTableExists.rows[0]?.exists) {
    const signatureCount = await driver.query<{ count: string }>(
      "select count(*)::text as count from _prisma.signatures where space <> '_prisma'",
    );
    expect(signatureCount.rows[0]?.count ?? '0').toBe('0');
  }

  if (ledgerTableExists.rows[0]?.exists) {
    const ledgerCount = await driver.query<{ count: string }>(
      "select count(*)::text as count from _prisma.ledger where space <> '_prisma'",
    );
    expect(ledgerCount.rows[0]?.count ?? '0').toBe('0');
  }
}
