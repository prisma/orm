import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { defineContractFor } from '../../src/contract/define-contract';
import { postgresContractCapabilities } from '../../src/exports/config';
import { defineContract } from '../../src/exports/contract-builder';
import {
  version16Capabilities,
  version17Capabilities,
  versionsWithALaterFeature,
} from '../support/version-table';

const removedFlags = {
  postgres: ['orderBy', 'limit', 'lateral', 'jsonAgg', 'returning'],
  sql: ['enums'],
};

const defineContractWithALaterFeature = defineContractFor(versionsWithALaterFeature);

// The default capabilities list is the client's adapter's and driver's: the driver provides interactive transactions.
function withTheDefaultConnection<Row extends { readonly sql: object }>(row: Row) {
  return { ...row, sql: { ...row.sql, interactiveTransactions: true } };
}

describe('the version a TypeScript contract states', () => {
  it('selects its own row of the table', () => {
    expect([
      defineContractWithALaterFeature({ databaseVersion: 16 }).capabilities,
      defineContractWithALaterFeature({ databaseVersion: 17 }).capabilities,
    ]).toEqual([
      withTheDefaultConnection(version16Capabilities),
      withTheDefaultConnection(version17Capabilities),
    ]);
  });

  it.each([15, 16, 17, 18] as const)(
    'makes version %i require its row of the shipped table',
    (version) => {
      expect(defineContract({ databaseVersion: version }).capabilities).toEqual(
        withTheDefaultConnection(postgresCapabilitiesByVersion[version]),
      );
    },
  );

  it('requires none of the flags nothing reads', () => {
    const { capabilities } = defineContract({ databaseVersion: 18 });
    for (const [namespace, flags] of Object.entries(removedFlags)) {
      for (const flag of flags) {
        expect(capabilities[namespace as 'sql']).not.toHaveProperty(flag);
      }
    }
  });

  it('refuses a contract that states no version, saying how to state it', () => {
    expect(() => defineContract({} as { databaseVersion: 15 })).toThrow(
      'State the PostgreSQL version your database runs in defineContract, for example defineContract({ databaseVersion: 18, ... }). The supported versions are 15, 16, 17, 18.',
    );
  });

  it('refuses a version written as a string, saying to write the number', () => {
    expect(() => defineContract({ databaseVersion: '17' as unknown as 17 })).toThrow(
      "Write the PostgreSQL version as the number 17, not the string '17'.",
    );
  });

  it('refuses a version the table does not list', () => {
    expect(() => defineContract({ databaseVersion: 14 as 15 })).toThrow(
      'PostgreSQL 14 is not supported. The supported versions are 15, 16, 17, 18.',
    );
  });

  it('keeps the flags of the extensions it lists', () => {
    const example = {
      kind: 'extension',
      id: 'example',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      capabilities: { example: { search: true } },
    } as const;

    expect(defineContract({ databaseVersion: 18, extensions: { example } }).capabilities).toEqual({
      ...withTheDefaultConnection(postgresCapabilitiesByVersion[18]),
      example: { search: true },
    });
  });
});

describe('the capabilities list of a TypeScript contract', () => {
  it('merges the sets over the row in order, a later flag replacing an earlier one and false turning one off', () => {
    const { capabilities } = defineContract({
      databaseVersion: 15,
      capabilities: [
        { sql: { returning: false, interactiveTransactions: true, pipelining: true } },
        { sql: { pipelining: false }, http: { batch: true } },
      ],
    });
    const { returning: _returning, ...sql } = postgresCapabilitiesByVersion[15].sql;

    expect(capabilities).toEqual({
      ...postgresCapabilitiesByVersion[15],
      sql: { ...sql, interactiveTransactions: true },
      http: { batch: true },
    });
  });

  it('refuses a single set where the list belongs, as a JavaScript caller might pass it', () => {
    expect(() =>
      defineContract({
        databaseVersion: 18,
        capabilities: { sql: { interactiveTransactions: true } } as unknown as [],
      }),
    ).toThrow(
      'capabilities is a list of capability sets, for example capabilities: [{ sql: { interactiveTransactions: true } }].',
    );
  });

  it('defaults to the adapter and driver the client runs with, whose driver provides interactive transactions', () => {
    expect(defineContract({ databaseVersion: 17 }).capabilities).toEqual(
      defineContract({
        databaseVersion: 17,
        capabilities: [postgresAdapter.capabilities, postgresDriver.capabilities],
      }).capabilities,
    );
    expect(defineContract({ databaseVersion: 17 }).capabilities.sql.interactiveTransactions).toBe(
      true,
    );
    expect(
      defineContract({ databaseVersion: 17, capabilities: [] }).capabilities.sql,
    ).not.toHaveProperty('interactiveTransactions');
  });

  it('gives the same capabilities as postgresContractCapabilities, for configs built by hand', () => {
    const capabilities = [{ sql: { interactiveTransactions: true } }] as const;
    expect(defineContract({ databaseVersion: 16, capabilities }).capabilities).toEqual(
      postgresContractCapabilities({ databaseVersion: 16, capabilities }),
    );
  });
});
