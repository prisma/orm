import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import {
  sqliteBigint,
  sqliteBlob,
  sqliteDataTypes,
  sqliteDatetime,
  sqliteInteger,
  sqliteJson,
  sqliteReal,
  sqliteText,
} from '../src/core/data-types';

const sourcesOf = (type: { readonly casts: Readonly<Record<string, unknown>> }) =>
  Object.keys(type.casts).sort();

describe('the data types this target registers', () => {
  it('registers the types it distinguishes, not one per storage class', () => {
    expect(sqliteDataTypes.map((type) => type.id).sort()).toEqual([
      'sqlite/bigint',
      'sqlite/blob',
      'sqlite/datetime',
      'sqlite/integer',
      'sqlite/json',
      'sqlite/real',
      'sqlite/text',
    ]);
  });

  it.each([
    ['sqlite/text', sqliteText, []],
    ['sqlite/json', sqliteJson, []],
    ['sqlite/integer', sqliteInteger, []],
    ['sqlite/datetime', sqliteDatetime, ['sqlite/text']],
    ['sqlite/blob', sqliteBlob, ['sqlite/text']],
    ['sqlite/bigint', sqliteBigint, ['sqlite/integer']],
    ['sqlite/real', sqliteReal, ['sqlite/bigint', 'sqlite/integer']],
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
      'sqlite/integer to sqlite/bigint, a number to digit text',
      sqliteBigint,
      sqliteInteger.id,
      42,
      '42',
    ],
    ['sqlite/integer to sqlite/real, a number either way', sqliteReal, sqliteInteger.id, 42, 42],
    ['sqlite/bigint to sqlite/real, digit text to a number', sqliteReal, sqliteBigint.id, '42', 42],
    [
      'sqlite/text to sqlite/datetime, the instant in UTC',
      sqliteDatetime,
      sqliteText.id,
      '2020-01-01T01:00:00.000+01:00',
      '2020-01-01T00:00:00Z',
    ],
    ['sqlite/text to sqlite/blob, the text unchanged', sqliteBlob, sqliteText.id, 'AA==', 'AA=='],
  ])('%s', (_name, type, source, value, converted) => {
    expect(type.casts[source]?.(value)).toEqual(converted);
  });
});

describe('the canonical form of sqlite/bigint', () => {
  it.each([
    ['digit text', '9007199254740993', '9007199254740993'],
    ['digit text with leading zeros', '-007', '-7'],
    ['a safe integer, as SQLite reads back an INTEGER default', 42, '42'],
    ['a negative safe integer', -1, '-1'],
  ])('reads %s as its digit text', (_name, value, canonical) => {
    expect(sqliteBigint.toCanonicalForm?.(value)).toBe(canonical);
  });

  it.each([
    ['a number past the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['a fraction', 1.5],
    ['text that is not an integer', '1.5'],
  ])('refuses %s with a cast-level code', (_name, value) => {
    expect(() => sqliteBigint.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});
