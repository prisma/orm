import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import {
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteDataTypes,
  sqliteInteger,
  sqliteReal,
  sqliteText,
} from '../src/core/data-types';

const sourcesOf = (type: { readonly casts: Readonly<Record<string, unknown>> }) =>
  Object.keys(type.casts).sort();

describe('the data types this target registers', () => {
  it('registers the types the database stores', () => {
    expect(sqliteDataTypes.map((type) => type.id).sort()).toEqual([
      'sqlite/blob',
      'sqlite/character',
      'sqlite/character-varying',
      'sqlite/integer',
      'sqlite/real',
      'sqlite/text',
    ]);
  });

  it.each([
    ['sqlite/text', sqliteText, []],
    ['sqlite/integer', sqliteInteger, []],
    ['sqlite/real', sqliteReal, ['sqlite/integer']],
    ['sqlite/blob', sqliteBlob, ['sqlite/text']],
    ['sqlite/character', sqliteCharacter, ['sqlite/text']],
    ['sqlite/character-varying', sqliteCharacterVarying, ['sqlite/text']],
  ])('%s casts from exactly the types the design names', (_id, type, sources) => {
    expect(sourcesOf(type)).toEqual(sources);
  });

  it('declares no type that takes a sql/expression value through a cast or a list cast', () => {
    expect(
      sqliteDataTypes.filter(
        (type) =>
          'sql/expression' in type.casts ||
          type.listCast?.of.includes(SQL_EXPRESSION_DATA_TYPE_ID) === true,
      ),
    ).toEqual([]);
  });
});

describe('what each cast converts', () => {
  it.each([
    [
      'sqlite/integer to sqlite/real, digit text to a number',
      sqliteReal,
      sqliteInteger.id,
      '42',
      42,
    ],
    [
      'sqlite/integer to sqlite/real, a negative 64-bit bound to the nearest double',
      sqliteReal,
      sqliteInteger.id,
      '-9223372036854775808',
      Number('-9223372036854775808'),
    ],
    ['sqlite/text to sqlite/blob, the text unchanged', sqliteBlob, sqliteText.id, 'AA==', 'AA=='],
    [
      'sqlite/text to sqlite/character, the text unchanged',
      sqliteCharacter,
      sqliteText.id,
      'abc',
      'abc',
    ],
    [
      'sqlite/text to sqlite/character-varying, the text unchanged',
      sqliteCharacterVarying,
      sqliteText.id,
      'abc',
      'abc',
    ],
  ])('%s', (_name, type, source, value, converted) => {
    expect(type.casts[source]?.(value)).toEqual(converted);
  });

  it('refuses an integer value that is not digit text', () => {
    expect(() => sqliteReal.casts[sqliteInteger.id]?.(42)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});

describe('the canonical form of sqlite/integer', () => {
  it.each([
    ['digit text', '9007199254740993', '9007199254740993'],
    ['digit text with leading zeros', '-007', '-7'],
    ['a safe integer, as SQLite reads back an INTEGER default', 42, '42'],
    ['a negative safe integer', -1, '-1'],
  ])('reads %s as its digit text', (_name, value, canonical) => {
    expect(sqliteInteger.toCanonicalForm?.(value)).toBe(canonical);
  });

  it.each([
    ['a number past the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['a fraction', 1.5],
    ['text that is not an integer', '1.5'],
  ])('refuses %s with a cast-level code', (_name, value) => {
    expect(() => sqliteInteger.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});
