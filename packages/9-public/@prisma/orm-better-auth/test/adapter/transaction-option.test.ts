import { defineContract, postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';
import postgres from '@prisma/orm-postgres/runtime';
import { defineContract as defineSqliteContract } from '@prisma/orm-sqlite/contract-builder';
import sqlite from '@prisma/orm-sqlite/runtime';
import { describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';

const url = 'postgres://localhost:5432/db';
// The driver provides interactive transactions; a contract that leaves its list out does not require them.
const withTransactions = postgres({
  contract: defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }),
  url,
});
const withoutTransactions = postgres({
  contract: defineContract({ requiredCapabilities: postgres18 }),
  url,
});

describe('the transaction option', () => {
  it('accepts a client whose contract does not list interactive transactions while it is off', () => {
    expect(() => prismaAdapter(withoutTransactions)).not.toThrow();
    expect(() => prismaAdapter(withoutTransactions, { transaction: false })).not.toThrow();
  });

  it('accepts a client whose contract lists them when it is on', () => {
    expect(() => prismaAdapter(withTransactions, { transaction: true })).not.toThrow();
  });

  it('refuses a client whose contract does not list them when it is on, as a JavaScript caller might pass it', () => {
    const options = { transaction: true } as const;
    expect(() =>
      // @ts-expect-error the type already refuses it
      prismaAdapter(withoutTransactions, options),
    ).toThrow(
      "The transaction option is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. The option runs Better Auth transactions through the client's `transaction()`, which needs it. To enable it, add `sql.interactiveTransactions` to your contract's required capabilities.",
    );
  });

  it('accepts a SQLite client when it is on: its adapter lists interactive transactions', () => {
    const client = sqlite({ contract: defineSqliteContract({}), path: ':memory:' });
    expect(() => prismaAdapter(client, { transaction: true })).not.toThrow();
  });
});
