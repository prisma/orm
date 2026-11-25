import { describe, expect, it } from 'vitest';
import {
  postgresDatabaseCapabilitiesNotProvided,
  postgresDatabaseCapabilitiesNotProvidedMessage,
} from '../src/core/database-capabilities-not-provided';
import {
  type CapabilitiesByVersion,
  postgresCapabilitiesByVersion,
} from '../src/core/server-version';

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
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or state version 16 for your contract, which turns off the features that need 17. If its capabilities list turns one of them on (sql.mergeReturning), remove it there.',
    );
  });

  it('names the capabilities no version provides beside those a later version provides', () => {
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
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or state version 16 for your contract, which turns off the features that need 17. If its capabilities list turns one of them on (sql.mergeReturning), remove it there. It also requires postgres.elsewhere, which no PostgreSQL version Prisma supports provides: remove it from its capabilities list.',
    );
  });

  it('says to remove from the capabilities list what no version provides', () => {
    expect(
      postgresDatabaseCapabilitiesNotProvidedMessage(
        {
          kind: 'capabilities-missing',
          serverVersionNumber: 160004,
          missing: [
            { namespace: 'postgres', flag: 'elsewhere' },
            { namespace: 'postgres', flag: 'nowhere' },
          ],
        },
        table,
      ),
    ).toBe(
      "Your contract requires postgres.elsewhere and postgres.nowhere, which no PostgreSQL version Prisma supports provides. This database runs PostgreSQL 16.4. Remove them from your contract's capabilities list.",
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
      'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 16.4. Either upgrade the database, or state version 16 for your contract, which turns off the features that need 17. If its capabilities list turns one of them on (sql.mergeReturning), remove it there.',
    );
  });
});

/** The pairs of a version and the one before it whose flags that are on the later version does not keep on. */
function versionsDroppingAFlag(capabilitiesByVersion: CapabilitiesByVersion) {
  const versions = Object.keys(capabilitiesByVersion).map(Number);
  const flagsOn = (version: number) =>
    Object.entries(capabilitiesByVersion[version] ?? {}).flatMap(([namespace, flags]) =>
      Object.entries(flags).flatMap(([flag, on]) => (on ? [`${namespace}.${flag}`] : [])),
    );
  return versions.slice(1).flatMap((version, index) => {
    const previous = versions[index] ?? version;
    const dropped = flagsOn(previous).filter((flag) => !flagsOn(version).includes(flag));
    return dropped.length === 0 ? [] : [{ version, previous, dropped }];
  });
}

describe("PostgreSQL's table of versions", () => {
  it('gives each version every flag that is on in the version before it, which the message\'s "PostgreSQL N or later" depends on: a version that drops a flag needs its own wording', () => {
    expect(versionsDroppingAFlag(postgresCapabilitiesByVersion)).toEqual([]);
  });

  it('counts a flag written off and then turned on as gained, and one turned off as dropped', () => {
    expect(
      versionsDroppingAFlag({
        15: { sql: { returning: true, mergeReturning: false } },
        16: { sql: { returning: true, mergeReturning: true } },
        17: { sql: { returning: false, mergeReturning: true } },
      }),
    ).toEqual([{ version: 17, previous: 16, dropped: ['sql.returning'] }]);
  });
});
