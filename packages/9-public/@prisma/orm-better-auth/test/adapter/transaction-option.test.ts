import {
  defaultConnectionCapabilities,
  defineContract,
} from '@prisma/orm-postgres/contract-builder';
import postgres from '@prisma/orm-postgres/runtime';
import { defineContract as defineSqliteContract } from '@prisma/orm-sqlite/contract-builder';
import sqlite from '@prisma/orm-sqlite/runtime';
import { describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/exports/index';

const url = 'postgres://localhost:5432/db';
const [postgresAdapterCapabilities] = defaultConnectionCapabilities;

// Without a list, a contract requires the adapter's and the driver's capabilities, interactive transactions among them; this list names only the adapter's.
const withTransactions = postgres({ contract: defineContract({ databaseVersion: 18 }), url });
const withoutTransactions = postgres({
  contract: defineContract({ databaseVersion: 18, capabilities: [postgresAdapterCapabilities] }),
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
      'The transaction option runs Better Auth transactions through the client’s transaction(), and this client’s contract does not list capability sql.interactiveTransactions. State a capabilities list that includes the driver’s, or turn the option off.',
    );
  });

  it('accepts a SQLite client when it is on: its adapter lists interactive transactions', () => {
    const client = sqlite({ contract: defineSqliteContract({}), path: ':memory:' });
    expect(() => prismaAdapter(client, { transaction: true })).not.toThrow();
  });
});
