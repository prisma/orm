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

describe('the version a TypeScript contract states', () => {
  it('selects its own row of the table', () => {
    expect([
      defineContractWithALaterFeature({ version: 16 }).capabilities,
      defineContractWithALaterFeature({ version: 17 }).capabilities,
    ]).toEqual([version16Capabilities, version17Capabilities]);
  });

  it.each([15, 16, 17, 18] as const)(
    'makes version %i require its row of the shipped table',
    (version) => {
      expect(defineContract({ version }).capabilities).toEqual(
        postgresCapabilitiesByVersion[version],
      );
    },
  );

  it('requires none of the flags nothing reads', () => {
    const { capabilities } = defineContract({ version: 18 });
    for (const [namespace, flags] of Object.entries(removedFlags)) {
      for (const flag of flags) {
        expect(capabilities[namespace as 'sql']).not.toHaveProperty(flag);
      }
    }
  });

  it('refuses a contract that states no version, saying how to state it', () => {
    expect(() => defineContract({} as { version: 15 })).toThrow(
      'State the PostgreSQL version your database runs in defineContract, for example defineContract({ version: 18, ... }). The supported versions are 15, 16, 17, 18.',
    );
  });

  it('refuses a version written as a string, saying to write the number', () => {
    expect(() => defineContract({ version: '17' as unknown as 17 })).toThrow(
      "Write the PostgreSQL version as the number 17, not the string '17'.",
    );
  });

  it('refuses a version the table does not list', () => {
    expect(() => defineContract({ version: 14 as 15 })).toThrow(
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

    expect(defineContract({ version: 18, extensions: { example } }).capabilities).toEqual({
      ...postgresCapabilitiesByVersion[18],
      example: { search: true },
    });
  });
});

describe('the capabilities list of a TypeScript contract', () => {
  it('merges the sets over the row in order, a later flag replacing an earlier one and false turning one off', () => {
    const { capabilities } = defineContract({
      version: 15,
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

  it('defaults to the adapter and driver the client runs with, which add nothing yet', () => {
    expect(defineContract({ version: 17 }).capabilities).toEqual(
      defineContract({ version: 17, capabilities: [] }).capabilities,
    );
  });

  it('gives the same capabilities as postgresContractCapabilities, for configs built by hand', () => {
    const capabilities = [{ sql: { interactiveTransactions: true } }] as const;
    expect(defineContract({ version: 16, capabilities }).capabilities).toEqual(
      postgresContractCapabilities({ version: 16, capabilities }),
    );
  });
});
