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
      'sqlite/text to sqlite/datetime, the text unchanged',
      sqliteDatetime,
      sqliteText.id,
      '2020-01-01',
      '2020-01-01',
    ],
    ['sqlite/text to sqlite/blob, the text unchanged', sqliteBlob, sqliteText.id, 'AA==', 'AA=='],
  ])('%s', (_name, type, source, value, converted) => {
    expect(type.casts[source]?.(value)).toEqual(converted);
  });
});
