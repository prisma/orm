import { describe, expect, it } from 'vitest';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from '../../src/core/migrations/default-constraint-names';

describe('defaultPrimaryKeyName', () => {
  it('appends _pkey to the table name', () => {
    expect(defaultPrimaryKeyName('Post')).toBe('Post_pkey');
  });

  it.each([
    { bytes: 58, table: 'a'.repeat(58), name: `${'a'.repeat(58)}_pkey` },
    { bytes: 59, table: 'a'.repeat(59), name: `${'a'.repeat(58)}_pkey` },
    { bytes: 63, table: 'a'.repeat(63), name: `${'a'.repeat(58)}_pkey` },
  ])(
    'cuts a $bytes-byte table name to fit 63 bytes, as Postgres names an unnamed primary key',
    ({ table, name }) => {
      expect(defaultPrimaryKeyName(table)).toBe(name);
    },
  );

  it('cuts a multibyte table name on a character boundary', () => {
    expect(defaultPrimaryKeyName('Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_cüt')).toBe(
      'Ünïcödé_täble_nämé_thät_ïs_löng_ënöügh_tö_c_pkey',
    );
  });
});

describe('defaultForeignKeyName and defaultUniqueName', () => {
  it('keep the whole name, which the planner always writes into the DDL', () => {
    const table = 'a'.repeat(60);

    expect(defaultForeignKeyName(table, ['ownerId'])).toBe(`${table}_ownerId_fkey`);
    expect(defaultUniqueName(table, ['code'])).toBe(`${table}_code_key`);
  });
});
