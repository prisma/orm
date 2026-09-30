import type { CodecControlHooks } from '@internal/family-sql/control';
import { describe, expect, it } from 'vitest';
import { buildPostgresNativeTypeExpander } from '../../src/core/migrations/native-type-expander';

const lengthHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) =>
    `${nativeType}(${String(typeParams?.['length'])})`,
};

const components = [
  {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'test',
    version: '0.0.1',
    types: { codecTypes: { controlPlaneHooks: { 'sql/char@1': lengthHooks } } },
  },
] as never;

describe('buildPostgresNativeTypeExpander', () => {
  it('writes character and bit without a length as PostgreSQL stores them, with a length of 1', () => {
    const expand = buildPostgresNativeTypeExpander(components);
    expect([
      expand({ nativeType: 'character', codecId: 'sql/char@1' }),
      expand({ nativeType: 'bit', codecId: 'pg/bit@1' }),
    ]).toEqual(['character(1)', 'bit(1)']);
  });

  it('keeps a length the column declares, and a varying type without one', () => {
    const expand = buildPostgresNativeTypeExpander(components);
    expect([
      expand({ nativeType: 'character', codecId: 'sql/char@1', typeParams: { length: 3 } }),
      expand({ nativeType: 'character varying', codecId: 'sql/varchar@1' }),
      expand({ nativeType: 'bit varying', codecId: 'pg/varbit@1' }),
    ]).toEqual(['character(3)', 'character varying', 'bit varying']);
  });

  it('applies the same rule without framework components', () => {
    expect(buildPostgresNativeTypeExpander(undefined)({ nativeType: 'character' })).toBe(
      'character(1)',
    );
  });
});
