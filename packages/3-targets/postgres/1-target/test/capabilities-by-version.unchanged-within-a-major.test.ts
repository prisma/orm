import { describe, expect, it } from 'vitest';
import { postgresCapabilitiesByVersion } from '../src/exports/server-version';

// Written out by hand, not read from the table, so that a change to the table fails here.
const capabilitiesAsShipped = {
  15: {
    postgres: { distinctOn: true, forKeyShare: true, forNoKeyUpdate: true },
    sql: {
      checkConstraint: true,
      defaultInInsert: true,
      forShare: true,
      forUpdate: true,
      insertOnConflictSkip: true,
      insertOnConflictTarget: true,
      insertOnConflictWithoutTarget: true,
      jsonAgg: true,
      jsonAggWithoutTruncation: true,
      lateral: true,
      lockNowait: true,
      lockOf: true,
      lockSkipLocked: true,
      outerReferencesInDerivedTables: true,
      returning: true,
      scalarList: true,
    },
  },
  16: {
    postgres: { distinctOn: true, forKeyShare: true, forNoKeyUpdate: true },
    sql: {
      checkConstraint: true,
      defaultInInsert: true,
      forShare: true,
      forUpdate: true,
      insertOnConflictSkip: true,
      insertOnConflictTarget: true,
      insertOnConflictWithoutTarget: true,
      jsonAgg: true,
      jsonAggWithoutTruncation: true,
      lateral: true,
      lockNowait: true,
      lockOf: true,
      lockSkipLocked: true,
      outerReferencesInDerivedTables: true,
      returning: true,
      scalarList: true,
    },
  },
  17: {
    postgres: { distinctOn: true, forKeyShare: true, forNoKeyUpdate: true },
    sql: {
      checkConstraint: true,
      defaultInInsert: true,
      forShare: true,
      forUpdate: true,
      insertOnConflictSkip: true,
      insertOnConflictTarget: true,
      insertOnConflictWithoutTarget: true,
      jsonAgg: true,
      jsonAggWithoutTruncation: true,
      lateral: true,
      lockNowait: true,
      lockOf: true,
      lockSkipLocked: true,
      outerReferencesInDerivedTables: true,
      returning: true,
      scalarList: true,
    },
  },
  18: {
    postgres: { distinctOn: true, forKeyShare: true, forNoKeyUpdate: true },
    sql: {
      checkConstraint: true,
      defaultInInsert: true,
      forShare: true,
      forUpdate: true,
      insertOnConflictSkip: true,
      insertOnConflictTarget: true,
      insertOnConflictWithoutTarget: true,
      jsonAgg: true,
      jsonAggWithoutTruncation: true,
      lateral: true,
      lockNowait: true,
      lockOf: true,
      lockSkipLocked: true,
      outerReferencesInDerivedTables: true,
      returning: true,
      scalarList: true,
    },
  },
};

describe("a supported PostgreSQL version's capability list does not change within a major version", () => {
  it('changing it changes the profile hash of every contract written for that version, so every signed database must be signed again: only a major version may do that; adding a new version is fine', () => {
    const shipped = Object.fromEntries(
      Object.keys(capabilitiesAsShipped).map((version) => [
        version,
        postgresCapabilitiesByVersion[
          Number(version) as keyof typeof postgresCapabilitiesByVersion
        ],
      ]),
    );
    expect(shipped).toEqual(capabilitiesAsShipped);
  });
});
