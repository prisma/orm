import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { postgresContractCapabilities } from '../../src/exports/config';
import {
  defineContract,
  postgres15,
  postgres16,
  postgres17,
  postgres18,
  postgresDriver,
} from '../../src/exports/contract-builder';

const removedFlags = {
  postgres: ['orderBy', 'limit', 'lateral', 'jsonAgg', 'returning'],
  sql: ['enums'],
};

function keysOf(row: Readonly<Record<string, Readonly<Record<string, boolean>>>>) {
  return Object.entries(row).flatMap(([namespace, flags]) =>
    Object.keys(flags).map((flag) => `${namespace}.${flag}`),
  );
}

describe('the lists of what a version and the driver provide', () => {
  it.each([
    [15, postgres15],
    [16, postgres16],
    [17, postgres17],
    [18, postgres18],
  ] as const)('lists every capability of version %i in the target’s table', (version, list) => {
    expect(list).toEqual(keysOf(postgresCapabilitiesByVersion[version]));
  });

  it('lists the driver’s interactive transactions', () => {
    expect(postgresDriver).toEqual(['sql.interactiveTransactions']);
  });

  it('cannot be changed by an author who spreads them', () => {
    expect([postgres18, postgresDriver].every(Object.isFrozen)).toBe(true);
  });
});

describe('the required capabilities of a TypeScript contract', () => {
  it('are stored as the contract records them, each key in its namespace', () => {
    expect(
      defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }).capabilities,
    ).toEqual({
      ...postgresCapabilitiesByVersion[18],
      sql: { ...postgresCapabilitiesByVersion[18].sql, interactiveTransactions: true },
    });
  });

  it('are only what the list names: a key left out is not required, and an unknown one is kept', () => {
    const { capabilities } = defineContract({
      requiredCapabilities: [
        ...postgres15.filter((capability) => capability !== 'sql.returning'),
        'http.batch',
      ],
    });
    const { returning: _returning, ...sql } = postgresCapabilitiesByVersion[15].sql;

    expect(capabilities).toEqual({
      ...postgresCapabilitiesByVersion[15],
      sql,
      http: { batch: true },
    });
  });

  it('include none of the flags nothing reads', () => {
    const { capabilities } = defineContract({ requiredCapabilities: postgres18 });
    for (const [namespace, flags] of Object.entries(removedFlags)) {
      for (const flag of flags) {
        expect(capabilities[namespace as 'sql']).not.toHaveProperty(flag);
      }
    }
  });

  it('keep the flags of the extensions the contract lists', () => {
    const example = {
      kind: 'extension',
      id: 'example',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      capabilities: { example: { search: true } },
    } as const;

    expect(
      defineContract({ requiredCapabilities: postgres18, extensions: { example } }).capabilities,
    ).toEqual({ ...postgresCapabilitiesByVersion[18], example: { search: true } });
  });

  it('are the same as postgresContractCapabilities gives, for configs built by hand', () => {
    const required = [...postgres16, ...postgresDriver];
    expect(defineContract({ requiredCapabilities: required }).capabilities).toEqual(
      postgresContractCapabilities(required),
    );
  });
});

describe('a contract that lists no required capabilities', () => {
  const refusal =
    'State the capabilities your contract requires in requiredCapabilities in defineContract. The list is missing or empty.';

  it('is refused when the list is missing, with no example', () => {
    expect(() => defineContract({} as { requiredCapabilities: [] })).toThrow(refusal);
  });

  it('is refused when the list is empty', () => {
    expect(() => defineContract({ requiredCapabilities: [] })).toThrow(refusal);
  });

  it('is refused by postgresContractCapabilities too', () => {
    expect(() => postgresContractCapabilities([])).toThrow(
      'State the capabilities your contract requires in requiredCapabilities given to postgresContractCapabilities. The list is missing or empty.',
    );
  });
});

describe('an entry that is not a capability key', () => {
  it.each([
    ['a key without a namespace', 'returning'],
    ['a capability set, as the removed capabilities option took', { sql: { returning: true } }],
  ])('is refused: %s', (_case, entry) => {
    expect(() =>
      defineContract({ requiredCapabilities: [entry] as unknown as ['sql.returning'] }),
    ).toThrow(
      `requiredCapabilities in defineContract lists ${JSON.stringify(entry)}, which is not a capability key. A key is a namespace and a flag joined by a dot, as error messages print it.`,
    );
  });
});
