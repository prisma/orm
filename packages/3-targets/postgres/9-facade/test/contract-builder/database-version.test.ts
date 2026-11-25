import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

const removedFlags = {
  postgres: ['orderBy', 'limit', 'lateral', 'jsonAgg', 'returning'],
  sql: ['enums'],
};

describe('the version a TypeScript contract states', () => {
  it.each([15, 16, 17, 18] as const)(
    'makes version %i require that row of the versions table',
    (version) => {
      expect(defineContract({ version }).capabilities).toEqual(postgresServerVersions[version]);
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

  it('refuses a version the table does not list, naming the supported ones', () => {
    expect(() => defineContract({ version: 14 as 15 })).toThrow(
      'PostgreSQL version 14 is not supported. State one of the supported versions: 15, 16, 17, 18.',
    );
  });

  it('refuses a contract that states no version', () => {
    expect(() => defineContract({} as { version: 15 })).toThrow(
      'PostgreSQL version undefined is not supported',
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
      ...postgresServerVersions[18],
      example: { search: true },
    });
  });
});

describe('the capabilities list of a TypeScript contract', () => {
  it('adds the connection capabilities to the version row, merging the sets in order', () => {
    const { capabilities } = defineContract({
      version: 15,
      capabilities: [
        { sql: { interactiveTransactions: true, pipelining: true } },
        { sql: { pipelining: false }, http: { batch: true } },
      ],
    });

    expect(capabilities).toEqual({
      ...postgresServerVersions[15],
      sql: { ...postgresServerVersions[15].sql, interactiveTransactions: true },
      http: { batch: true },
    });
  });

  it('defaults to the adapter and driver the client runs with, which add nothing yet', () => {
    expect(defineContract({ version: 17 }).capabilities).toEqual(
      defineContract({ version: 17, capabilities: [] }).capabilities,
    );
  });
});
