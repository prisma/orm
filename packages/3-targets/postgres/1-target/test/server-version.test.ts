import { describe, expect, it } from 'vitest';
import {
  POSTGRES_MIN_SERVER_VERSION,
  type PostgresServerVersion,
  postgresCapabilitiesForVersion,
  postgresServerVersions,
  resolveServerVersion,
} from '../src/exports/server-version';

const everyVersionsCapabilities = {
  postgres: { distinctOn: true, forNoKeyUpdate: true, forKeyShare: true },
  sql: {
    returning: true,
    defaultInInsert: true,
    lateral: true,
    scalarList: true,
    checkConstraint: true,
    insertOnConflictSkip: true,
    insertOnConflictWithoutTarget: true,
    insertOnConflictTarget: true,
    forUpdate: true,
    forShare: true,
    lockOf: true,
    lockNowait: true,
    lockSkipLocked: true,
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
  },
};

describe('the PostgreSQL server versions table', () => {
  it('lists versions 15 to 18, each with the capabilities PostgreSQL 15 already has', () => {
    expect(postgresServerVersions).toEqual({
      15: everyVersionsCapabilities,
      16: everyVersionsCapabilities,
      17: everyVersionsCapabilities,
      18: everyVersionsCapabilities,
    });
  });

  it('takes the minimum server version from its first row', () => {
    expect(POSTGRES_MIN_SERVER_VERSION).toBe('15');
  });

  it.each([15, 16, 17, 18] as const)('resolves version %i to its row', (version) => {
    expect(postgresCapabilitiesForVersion(version)).toBe(postgresServerVersions[version]);
  });

  it.each([14, 19, 17.1, '17', undefined])(
    'refuses %j, naming the supported versions',
    (version) => {
      expect(() =>
        postgresCapabilitiesForVersion(version as unknown as PostgresServerVersion),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: `PostgreSQL version ${JSON.stringify(version)} is not supported. State one of the supported versions: 15, 16, 17, 18.`,
        }),
      );
    },
  );
});

describe('resolveServerVersion', () => {
  it('resolves a version against any table, naming the database in its refusal', () => {
    const table = { 3: { sql: { a: true } }, 5: { sql: { a: true, b: true } } } as const;

    expect(resolveServerVersion(table, 5, 'Example')).toBe(table[5]);
    expect(() => resolveServerVersion(table, 4 as 3, 'Example')).toThrow(
      'Example version 4 is not supported. State one of the supported versions: 3, 5.',
    );
  });
});
