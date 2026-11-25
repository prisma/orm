import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  POSTGRES_MIN_SERVER_VERSION,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
  postgresCapabilitiesForVersion,
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

function refusalOf(version: unknown): unknown {
  try {
    postgresCapabilitiesForVersion(version as PostgresVersion);
  } catch (error) {
    return error;
  }
  throw new Error(`${String(version)} was not refused`);
}

describe('the capabilities by PostgreSQL version', () => {
  it('lists versions 15 to 18, each with the capabilities PostgreSQL 15 already has', () => {
    expect(postgresCapabilitiesByVersion).toEqual({
      15: everyVersionsCapabilities,
      16: everyVersionsCapabilities,
      17: everyVersionsCapabilities,
      18: everyVersionsCapabilities,
    });
  });

  it('takes the minimum server version from its first row, typed as the literal', () => {
    expect(POSTGRES_MIN_SERVER_VERSION).toBe('15');
    expectTypeOf(POSTGRES_MIN_SERVER_VERSION).toEqualTypeOf<'15'>();
  });

  it.each([15, 16, 17, 18] as const)('resolves version %i to its row', (version) => {
    expect(postgresCapabilitiesForVersion(version)).toBe(postgresCapabilitiesByVersion[version]);
  });

  it('resolves a version against the table it is given', () => {
    const table = { 3: { sql: { a: true } }, 5: { sql: { a: true, b: true } } } as const;
    expect(postgresCapabilitiesForVersion(5, table)).toBe(table[5]);
    expect(() => postgresCapabilitiesForVersion(4 as 3, table)).toThrow(
      'PostgreSQL 4 is not supported. The supported versions are 3, 5.',
    );
  });

  it.each([
    [14, 'PostgreSQL 14 is not supported. The supported versions are 15, 16, 17, 18.'],
    [19, 'PostgreSQL 19 is not supported. The supported versions are 15, 16, 17, 18.'],
    [17.1, 'PostgreSQL 17.1 is not supported. The supported versions are 15, 16, 17, 18.'],
    ['17', "Write the PostgreSQL version as the number 17, not the string '17'."],
    [
      Number.NaN,
      'Write the PostgreSQL version as a number, for example version: 18. The supported versions are 15, 16, 17, 18.',
    ],
    [
      undefined,
      'State the PostgreSQL version your database runs, for example version: 18. The supported versions are 15, 16, 17, 18.',
    ],
    [
      null,
      'State the PostgreSQL version your database runs, for example version: 18. The supported versions are 15, 16, 17, 18.',
    ],
  ])('refuses %j with a message that says what to write', (version, message) => {
    expect(refusalOf(version)).toMatchObject({ code: 'CONTRACT.ARGUMENT_INVALID', message });
  });
});
