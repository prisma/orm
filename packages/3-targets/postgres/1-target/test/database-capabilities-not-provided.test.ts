import { describe, expect, it } from 'vitest';
import {
  postgresDatabaseCapabilitiesNotProvided,
  postgresDatabaseCapabilitiesNotProvidedMessage,
} from '../src/core/database-capabilities-not-provided';
import { postgresCapabilitiesByVersion } from '../src/core/server-version';

// Every row of the shipped table is the same, since no PostgreSQL feature Prisma supports needs a version above 15. This table has a flag only from 17.
const table = {
  15: { sql: { returning: true } },
  16: { sql: { returning: true } },
  17: { sql: { returning: true, mergeReturning: true } },
} as const;

const forVersion17 = {
  sql: { returning: true, mergeReturning: true, interactiveTransactions: true },
};

function notProvidedOn(
  serverVersionNumber: number | undefined,
  capabilities: Record<string, Record<string, boolean>> = forVersion17,
) {
  return postgresDatabaseCapabilitiesNotProvided({ capabilities, table, serverVersionNumber });
}

describe('what a PostgreSQL database lacks of what a contract requires', () => {
  it('is nothing on a server whose row has every database flag the contract requires', () => {
    expect(notProvidedOn(170002)).toBeUndefined();
  });

  it('is nothing on a server newer than the last row, which is read as the last row', () => {
    expect(notProvidedOn(180001)).toBeUndefined();
  });

  it("is the database flags a server's row lacks, when the server is older than the contract requires", () => {
    expect(notProvidedOn(160004)).toEqual({
      kind: 'capabilities-missing',
      serverVersionNumber: 160004,
      missing: [{ namespace: 'sql', flag: 'mergeReturning' }],
    });
  });

  it('skips the flags the table does not hold, which the connection provides', () => {
    expect(
      notProvidedOn(160004, { sql: { returning: true, interactiveTransactions: true } }),
    ).toBeUndefined();
  });

  it('skips the flags the contract turns off', () => {
    expect(
      notProvidedOn(160004, { sql: { returning: true, mergeReturning: false } }),
    ).toBeUndefined();
  });

  it("is every database flag the contract requires on a server older than the table's first version", () => {
    expect(notProvidedOn(140010)).toEqual({
      kind: 'older-than-supported',
      serverVersionNumber: 140010,
      missing: [
        { namespace: 'sql', flag: 'returning' },
        { namespace: 'sql', flag: 'mergeReturning' },
      ],
    });
  });

  it("is a server older than the table's first version even when the contract requires no database flag", () => {
    expect(notProvidedOn(140010, { sql: { interactiveTransactions: true } })).toEqual({
      kind: 'older-than-supported',
      serverVersionNumber: 140010,
      missing: [],
    });
  });

  it('skips a namespace or flag the table holds only by inheritance, such as constructor', () => {
    expect(
      notProvidedOn(160004, {
        sql: { returning: true, constructor: true },
        constructor: { name: true },
      }),
    ).toBeUndefined();
  });

  it('is a version that could not be read', () => {
    expect(notProvidedOn(undefined)).toEqual({ kind: 'version-unread' });
  });
});

describe('the message for what a PostgreSQL database lacks', () => {
  it('names the version the contract requires, the version the database runs, and the version to state', () => {
    expect(
      postgresDatabaseCapabilitiesNotProvidedMessage(
        {
          kind: 'capabilities-missing',
          serverVersionNumber: 160004,
          missing: [{ namespace: 'sql', flag: 'mergeReturning' }],
        },
        table,
      ),
    ).toBe(
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or change your contract to require only what PostgreSQL 16 provides: the version it states and its capabilities list must not turn on the features that need 17.',
    );
  });

  it('names the capabilities when no version provides them all', () => {
    expect(
      postgresDatabaseCapabilitiesNotProvidedMessage(
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
      'Your contract requires sql.mergeReturning and postgres.elsewhere of the database, which no PostgreSQL version Prisma supports provides together. This database runs PostgreSQL 16.4. Change your contract to require only what PostgreSQL 16 provides: the version it states and its capabilities list must not turn on what PostgreSQL 16 lacks.',
    );
  });

  it("says only that this release needs the first version on a server older than the table's first version", () => {
    expect(
      postgresDatabaseCapabilitiesNotProvidedMessage(
        { kind: 'older-than-supported', serverVersionNumber: 140010, missing: [] },
        table,
      ),
    ).toBe(
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
    );
  });

  it('writes a version before PostgreSQL 10 with its two-part major version', () => {
    expect(
      postgresDatabaseCapabilitiesNotProvidedMessage(
        { kind: 'older-than-supported', serverVersionNumber: 90624, missing: [] },
        table,
      ),
    ).toBe(
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 9.6. Upgrade the database to PostgreSQL 15 or later.',
    );
  });

  it('says the version could not be read', () => {
    expect(postgresDatabaseCapabilitiesNotProvidedMessage({ kind: 'version-unread' }, table)).toBe(
      "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires.",
    );
  });
});

describe('the message for a flag the capabilities list turned on', () => {
  it('names no version to state, since the contract may already state the version the database runs', () => {
    const forVersion16WithMergeReturningTurnedOn = {
      sql: { returning: true, mergeReturning: true },
    };
    const notProvided = notProvidedOn(160004, forVersion16WithMergeReturningTurnedOn);

    expect(notProvided && postgresDatabaseCapabilitiesNotProvidedMessage(notProvided, table)).toBe(
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or change your contract to require only what PostgreSQL 16 provides: the version it states and its capabilities list must not turn on the features that need 17.',
    );
  });
});

describe("PostgreSQL's table of versions", () => {
  const versions = Object.keys(postgresCapabilitiesByVersion).map(Number);

  it.each(versions.slice(1).map((version, index) => [version, versions[index]] as const))(
    'gives %i every flag of %i, which the message\'s "PostgreSQL N or later" depends on: a version that drops a flag needs its own wording',
    (version, previous) => {
      const row =
        postgresCapabilitiesByVersion[version as keyof typeof postgresCapabilitiesByVersion];
      const before =
        postgresCapabilitiesByVersion[previous as keyof typeof postgresCapabilitiesByVersion];
      expect(row).toMatchObject(before);
    },
  );
});
