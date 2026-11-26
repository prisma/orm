import { describe, expect, it } from 'vitest';
import { postgresDatabaseNotProvided } from '../src/core/database-capabilities-not-provided';
import {
  type CapabilitiesByVersion,
  postgresCapabilitiesByVersion,
} from '../src/core/server-version';

// Every row of the shipped table is the same, since no PostgreSQL feature Prisma supports needs a version above 15. This table has rows that differ.
const table = {
  15: { sql: { returning: true } },
  16: { sql: { returning: true, jsonTable: true } },
  17: { sql: { returning: true, jsonTable: true, mergeReturning: true } },
} as const;

const connection = { sql: { interactiveTransactions: true } };

const forVersion17 = {
  sql: { returning: true, jsonTable: true, mergeReturning: true, interactiveTransactions: true },
};

function notProvidedOn(
  serverVersionNumber: number | undefined,
  capabilities: Record<string, Record<string, boolean>> = forVersion17,
) {
  return postgresDatabaseNotProvided({
    capabilities,
    table,
    serverVersionNumber,
    declaredCapabilities: connection,
  });
}

describe('what a PostgreSQL database does not provide of what a contract requires', () => {
  it('is nothing on a server whose row has every database capability the contract requires', () => {
    expect(notProvidedOn(170002)).toBeUndefined();
  });

  it('is nothing on a server newer than the last row, which is read as the last row', () => {
    expect(notProvidedOn(180001)).toBeUndefined();
  });

  it("is the capabilities a server's row lacks, each with the first version that provides it, and the version to state", () => {
    expect(notProvidedOn(150004)).toEqual({
      database: 'PostgreSQL',
      findings: [
        {
          kind: 'missing-capabilities',
          databaseVersion: '15.4',
          versionToState: 15,
          capabilities: [
            { capability: 'sql.jsonTable', firstVersion: 16 },
            { capability: 'sql.mergeReturning', firstVersion: 17 },
          ],
        },
      ],
    });
  });

  it('orders the missing capabilities by the first version that provides them', () => {
    expect(
      notProvidedOn(150004, { sql: { mergeReturning: true, returning: true, jsonTable: true } })
        ?.findings[0],
    ).toMatchObject({
      capabilities: [
        { capability: 'sql.jsonTable', firstVersion: 16 },
        { capability: 'sql.mergeReturning', firstVersion: 17 },
      ],
    });
  });

  it('is the capabilities no row provides and no component declares, as unrecognized', () => {
    expect(
      notProvidedOn(170002, { sql: { returning: true, someNewThing: true }, other: { x: true } }),
    ).toEqual({
      database: 'PostgreSQL',
      findings: [
        { kind: 'unrecognized-capabilities', capabilities: ['sql.someNewThing', 'other.x'] },
      ],
    });
  });

  it('is both, missing first, when the contract requires missing and unrecognized capabilities', () => {
    expect(
      notProvidedOn(160004, { sql: { returning: true, mergeReturning: true, someNewThing: true } }),
    ).toEqual({
      database: 'PostgreSQL',
      findings: [
        {
          kind: 'missing-capabilities',
          databaseVersion: '16.4',
          versionToState: 16,
          capabilities: [{ capability: 'sql.mergeReturning', firstVersion: 17 }],
        },
        { kind: 'unrecognized-capabilities', capabilities: ['sql.someNewThing'] },
      ],
    });
  });

  it('skips the capabilities a component declares', () => {
    expect(
      postgresDatabaseNotProvided({
        capabilities: {
          sql: { returning: true, interactiveTransactions: true, viaExtension: true },
        },
        table,
        serverVersionNumber: 160004,
        declaredCapabilities: { sql: { interactiveTransactions: true, viaExtension: true } },
      }),
    ).toBeUndefined();
  });

  it('skips the capabilities the contract turns off', () => {
    expect(
      notProvidedOn(150004, { sql: { returning: true, mergeReturning: false, unknown: false } }),
    ).toBeUndefined();
  });

  it("is a server older than the table's first version, whatever the contract requires", () => {
    expect(notProvidedOn(140010, { sql: { interactiveTransactions: true } })).toEqual({
      database: 'PostgreSQL',
      findings: [{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }],
    });
  });

  it('writes a version before PostgreSQL 10 with its two-part major version', () => {
    expect(notProvidedOn(90624)?.findings[0]).toEqual({
      kind: 'older-than-supported',
      databaseVersion: '9.6',
      oldestSupported: 15,
    });
  });

  it('skips a namespace or flag the table holds only by inheritance, such as constructor, as none it recognizes', () => {
    expect(
      notProvidedOn(160004, {
        sql: { returning: true, constructor: true },
        constructor: { name: true },
      }),
    ).toEqual({
      database: 'PostgreSQL',
      findings: [
        {
          kind: 'unrecognized-capabilities',
          capabilities: ['sql.constructor', 'constructor.name'],
        },
      ],
    });
  });

  it('is a version that could not be read, with the statement that reports it', () => {
    expect(notProvidedOn(undefined)).toEqual({
      database: 'PostgreSQL',
      findings: [{ kind: 'version-not-read', versionQuery: 'SHOW server_version_num' }],
    });
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
  it('gives each version every flag that is on in the version before it, which "first available in PostgreSQL N" depends on: a version that drops a flag needs its own wording', () => {
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
