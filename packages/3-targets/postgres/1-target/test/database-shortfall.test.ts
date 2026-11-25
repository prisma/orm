import { describe, expect, it } from 'vitest';
import {
  postgresDatabaseShortfall,
  postgresDatabaseShortfallMessage,
} from '../src/core/database-shortfall';

// Every row of the shipped table is the same, since no PostgreSQL feature Prisma supports needs a version above 15. This table has a flag only from 17.
const table = {
  15: { sql: { returning: true } },
  16: { sql: { returning: true } },
  17: { sql: { returning: true, mergeReturning: true } },
} as const;

const forVersion17 = {
  sql: { returning: true, mergeReturning: true, interactiveTransactions: true },
};

function shortfallOn(
  serverVersionNumber: number | undefined,
  capabilities: Record<string, Record<string, boolean>> = forVersion17,
) {
  return postgresDatabaseShortfall({ capabilities, table, serverVersionNumber });
}

describe('what a PostgreSQL database lacks of what a contract requires', () => {
  it('is nothing on a server whose row has every database flag the contract requires', () => {
    expect(shortfallOn(170002)).toBeUndefined();
  });

  it('is nothing on a server newer than the last row, which is read as the last row', () => {
    expect(shortfallOn(180001)).toBeUndefined();
  });

  it("is the database flags a server's row lacks, when the server is older than the contract requires", () => {
    expect(shortfallOn(160004)).toEqual({
      kind: 'capabilities-missing',
      serverVersionNumber: 160004,
      missing: [{ namespace: 'sql', flag: 'mergeReturning' }],
    });
  });

  it('skips the flags the table does not hold, which the connection provides', () => {
    expect(
      shortfallOn(160004, { sql: { returning: true, interactiveTransactions: true } }),
    ).toBeUndefined();
  });

  it('skips the flags the contract turns off', () => {
    expect(
      shortfallOn(160004, { sql: { returning: true, mergeReturning: false } }),
    ).toBeUndefined();
  });

  it("is every database flag the contract requires on a server older than the table's first version", () => {
    expect(shortfallOn(140010)).toEqual({
      kind: 'older-than-supported',
      serverVersionNumber: 140010,
      missing: [
        { namespace: 'sql', flag: 'returning' },
        { namespace: 'sql', flag: 'mergeReturning' },
      ],
    });
  });

  it("is a server older than the table's first version even when the contract requires no database flag", () => {
    expect(shortfallOn(140010, { sql: { interactiveTransactions: true } })).toEqual({
      kind: 'older-than-supported',
      serverVersionNumber: 140010,
      missing: [],
    });
  });

  it('is a version that could not be read', () => {
    expect(shortfallOn(undefined)).toEqual({ kind: 'version-unread' });
  });
});

describe('the message for what a PostgreSQL database lacks', () => {
  it('names the version the contract requires, the version the database runs, and the version to state', () => {
    expect(
      postgresDatabaseShortfallMessage(
        {
          kind: 'capabilities-missing',
          serverVersionNumber: 160004,
          missing: [{ namespace: 'sql', flag: 'mergeReturning' }],
        },
        table,
      ),
    ).toBe(
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or state version 16 for your contract, which turns off the features that need 17.',
    );
  });

  it('names the capabilities when no version provides them all', () => {
    expect(
      postgresDatabaseShortfallMessage(
        {
          kind: 'capabilities-missing',
          serverVersionNumber: 160004,
          missing: [
            { namespace: 'sql', flag: 'mergeReturning' },
            { namespace: 'postgres', flag: 'elsewhere' },
          ],
        },
        table,
      ),
    ).toBe(
      'Your contract requires sql.mergeReturning and postgres.elsewhere of the database, which no PostgreSQL version Prisma supports provides together. This database runs PostgreSQL 16.4. State version 16 for your contract, and remove from its capabilities list what that version does not provide.',
    );
  });

  it("says only that this release needs the first version on a server older than the table's first version", () => {
    expect(
      postgresDatabaseShortfallMessage(
        { kind: 'older-than-supported', serverVersionNumber: 140010, missing: [] },
        table,
      ),
    ).toBe(
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
    );
  });

  it('writes a version before PostgreSQL 10 with its two-part major version', () => {
    expect(
      postgresDatabaseShortfallMessage(
        { kind: 'older-than-supported', serverVersionNumber: 90624, missing: [] },
        table,
      ),
    ).toBe(
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 9.6. Upgrade the database to PostgreSQL 15 or later.',
    );
  });

  it('says the version could not be read', () => {
    expect(postgresDatabaseShortfallMessage({ kind: 'version-unread' }, table)).toBe(
      "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires.",
    );
  });
});
