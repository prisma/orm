import { describe, expect, expectTypeOf, it } from 'vitest';
import { type CapabilityKey, capabilitiesFromKeys, capabilityKeysOf } from '../src/capabilities';

describe('capabilitiesFromKeys', () => {
  it('stores each key as its namespace and flag, as a contract records them', () => {
    const capabilities = capabilitiesFromKeys([
      'sql.returning',
      'sql.lateral',
      'postgres.distinctOn',
    ]);

    expect(capabilities).toEqual({
      sql: { returning: true, lateral: true },
      postgres: { distinctOn: true },
    });
    expectTypeOf(capabilities).toEqualTypeOf<{
      readonly sql: { readonly returning: true; readonly lateral: true };
      readonly postgres: { readonly distinctOn: true };
    }>();
  });

  it('keeps each key literally in the type when the list is spread from lists typed as arrays', () => {
    const database: readonly ('sql.returning' | 'sql.lateral')[] = ['sql.returning', 'sql.lateral'];
    const connection: readonly 'sql.interactiveTransactions'[] = ['sql.interactiveTransactions'];
    const capabilities = capabilitiesFromKeys([...database, ...connection]);

    expect(capabilities).toEqual({
      sql: { returning: true, lateral: true, interactiveTransactions: true },
    });
    expectTypeOf(capabilities).toEqualTypeOf<{
      readonly sql: {
        readonly returning: true;
        readonly lateral: true;
        readonly interactiveTransactions: true;
      };
    }>();
  });

  it('splits a key at its first dot, so the flag may contain dots', () => {
    expect(capabilitiesFromKeys(['ext.search.fuzzy'])).toEqual({ ext: { 'search.fuzzy': true } });
  });
});

describe('capabilityKeysOf', () => {
  it('lists the flags that are on as keys, and leaves out the ones that are off', () => {
    const keys = capabilityKeysOf({
      sql: { returning: true, lateral: false },
      postgres: { distinctOn: true },
    } as const);

    expect(keys).toEqual(['sql.returning', 'postgres.distinctOn']);
    expectTypeOf(keys).toEqualTypeOf<readonly ('sql.returning' | 'postgres.distinctOn')[]>();
    expect(Object.isFrozen(keys)).toBe(true);
  });

  it('gives back the capabilities it was given, through capabilitiesFromKeys', () => {
    const matrix = { sql: { returning: true }, postgres: { distinctOn: true } } as const;
    expect(capabilitiesFromKeys(capabilityKeysOf(matrix))).toEqual(matrix);
  });

  it('lists nothing for a set with no flags', () => {
    const keys = capabilityKeysOf({} as const);
    expect(keys).toEqual([]);
    expectTypeOf(keys).toEqualTypeOf<readonly never[]>();
  });
});

describe('CapabilityKey', () => {
  it('is a namespace and a flag joined by a dot', () => {
    expectTypeOf<'sql.returning'>().toExtend<CapabilityKey>();
    expectTypeOf<'returning'>().not.toExtend<CapabilityKey>();
  });
});
