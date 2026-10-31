import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import {
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteDataTypes,
  sqliteDate,
  sqliteDatetime,
  sqliteDuration,
  sqliteInteger,
  sqliteJson,
  sqliteReal,
  sqliteText,
  sqliteTime,
} from '../src/core/data-types';

const sourcesOf = (type: { readonly casts: Readonly<Record<string, unknown>> }) =>
  Object.keys(type.casts).sort();

describe('the data types this target registers', () => {
  it('registers the types the database stores', () => {
    expect(sqliteDataTypes.map((type) => type.id).sort()).toEqual([
      'sql/raw',
      'sqlite/blob',
      'sqlite/character',
      'sqlite/character-varying',
      'sqlite/date',
      'sqlite/datetime',
      'sqlite/duration',
      'sqlite/integer',
      'sqlite/json',
      'sqlite/real',
      'sqlite/text',
      'sqlite/time',
    ]);
  });

  it.each([
    ['sqlite/text', sqliteText, []],
    ['sqlite/integer', sqliteInteger, []],
    ['sqlite/real', sqliteReal, ['sqlite/integer']],
    ['sqlite/blob', sqliteBlob, []],
    ['sqlite/character', sqliteCharacter, ['sqlite/text']],
    ['sqlite/character-varying', sqliteCharacterVarying, ['sqlite/text']],
    ['sqlite/datetime', sqliteDatetime, []],
    ['sqlite/date', sqliteDate, []],
    ['sqlite/time', sqliteTime, []],
    ['sqlite/duration', sqliteDuration, []],
    ['sqlite/json', sqliteJson, []],
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

describe('the types stored as text', () => {
  it('stores the date and time types and sqlite/json as sqlite/text, with no texts of their own', () => {
    expect(
      [sqliteDatetime, sqliteDate, sqliteTime, sqliteDuration, sqliteJson].map((type) => ({
        id: type.id,
        storedAs: type.sql.storedAs,
        texts: type.sql.texts,
      })),
    ).toEqual([
      { id: 'sqlite/datetime', storedAs: 'sqlite/text', texts: [] },
      { id: 'sqlite/date', storedAs: 'sqlite/text', texts: [] },
      { id: 'sqlite/time', storedAs: 'sqlite/text', texts: [] },
      { id: 'sqlite/duration', storedAs: 'sqlite/text', texts: [] },
      { id: 'sqlite/json', storedAs: 'sqlite/text', texts: [] },
    ]);
  });

  it('takes neither as a value of sqlite/text', () => {
    expect(Object.keys(sqliteText.casts)).toEqual([]);
  });

  it('reads a datetime only as the instant in UTC with three fraction digits', () => {
    expect(
      sqliteDatetime.toContract(sqliteDatetime.fromContract('2024-01-01T00:00:00.000Z', {})),
    ).toBe('2024-01-01T00:00:00.000Z');
  });

  it.each([
    ['no fraction', '2024-01-01T00:00:00Z'],
    ['two fraction digits', '2024-01-01T00:00:00.50Z'],
    ['an offset', '2024-01-01T01:00:00.000+01:00'],
    ['a space for the T', '2024-01-01 00:00:00.000Z'],
  ])('refuses a datetime with %s, naming the stored form', (_name, json) => {
    expect(() => sqliteDatetime.fromContract(json, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ dataType: 'sqlite/datetime' }),
      }),
    );
  });

  it('reads a document only as its JSON text with sorted keys and no added whitespace', () => {
    expect(sqliteJson.toContract(sqliteJson.fromContract('{"a":1,"b":[true]}', {}))).toBe(
      '{"a":1,"b":[true]}',
    );
  });

  it.each([
    ['unsorted keys', '{"b":1,"a":2}', '"{\\"a\\":2,\\"b\\":1}"'],
    ['added whitespace', '{ "a": 1 }', '"{\\"a\\":1}"'],
    ['text that is not JSON', 'plan', undefined],
  ])('refuses a document with %s', (_name, json, canonical) => {
    expect(() => sqliteJson.fromContract(json, {})).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          canonical === undefined
            ? 'sqlite/json JSON value must be the JSON text of a document'
            : `sqlite/json JSON value must be ${canonical}, as sqlite/json stores this value`,
      }),
    );
  });
});

describe('sqlite/datetime says what it reads', () => {
  it('refuses text that is no instant, describing the text it reads', () => {
    expect(() => sqliteDatetime.fromContract('2024-01-01T00:00:00', {})).toThrow(
      expect.objectContaining({
        message:
          'sqlite/datetime JSON value must be ISO 8601 date and time text with a UTC offset and at most three fraction digits, as in "2024-01-01T00:00:00Z"',
      }),
    );
  });
});
