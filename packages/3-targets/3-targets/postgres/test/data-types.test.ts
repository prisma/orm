import { describe, expect, it } from 'vitest';
import {
  pgBit,
  pgBool,
  pgBytea,
  pgChar,
  pgDate,
  pgEnum,
  pgFloat4,
  pgFloat8,
  pgInet,
  pgInt2,
  pgInt4,
  pgInt8,
  pgInterval,
  pgJson,
  pgJsonb,
  pgNumeric,
  pgText,
  pgTextArray,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgTsquery,
  pgUuid,
  pgVarbit,
  pgVarchar,
  postgresDataTypes,
} from '../src/core/data-types';

const sourcesOf = (type: { readonly casts: Readonly<Record<string, unknown>> }) =>
  Object.keys(type.casts).sort();

describe('the data types this target registers', () => {
  it('registers one declaration per type, each with its own id', () => {
    expect(postgresDataTypes.map((type) => type.id).sort()).toEqual([
      'pg/bit',
      'pg/bool',
      'pg/bytea',
      'pg/char',
      'pg/date',
      'pg/enum',
      'pg/float4',
      'pg/float8',
      'pg/inet',
      'pg/int2',
      'pg/int4',
      'pg/int8',
      'pg/interval',
      'pg/json',
      'pg/jsonb',
      'pg/numeric',
      'pg/text',
      'pg/text-array',
      'pg/time',
      'pg/timestamp',
      'pg/timestamptz',
      'pg/timetz',
      'pg/tsquery',
      'pg/uuid',
      'pg/varbit',
      'pg/varchar',
    ]);
  });

  it.each([
    ['pg/text', pgText, []],
    ['pg/text-array', pgTextArray, []],
    ['pg/enum', pgEnum, []],
    ['pg/int2', pgInt2, []],
    ['pg/bool', pgBool, []],
    ['pg/json', pgJson, []],
    ['pg/int4', pgInt4, ['pg/int2']],
    ['pg/int8', pgInt8, ['pg/int2', 'pg/int4']],
    ['pg/numeric', pgNumeric, ['pg/int2', 'pg/int4', 'pg/int8']],
    ['pg/float4', pgFloat4, ['pg/int2', 'pg/int4', 'pg/int8', 'pg/numeric']],
    ['pg/float8', pgFloat8, ['pg/int2', 'pg/int4', 'pg/int8', 'pg/numeric']],
    ['pg/jsonb', pgJsonb, ['pg/json']],
    ['pg/char', pgChar, ['pg/text']],
    ['pg/varchar', pgVarchar, ['pg/text']],
    ['pg/uuid', pgUuid, ['pg/text']],
    ['pg/inet', pgInet, ['pg/text']],
    ['pg/bit', pgBit, ['pg/text']],
    ['pg/varbit', pgVarbit, ['pg/text']],
    ['pg/timetz', pgTimetz, ['pg/text']],
    ['pg/interval', pgInterval, ['pg/text']],
    ['pg/bytea', pgBytea, ['pg/text']],
    ['pg/date', pgDate, ['pg/text']],
    ['pg/time', pgTime, ['pg/text']],
    ['pg/timestamp', pgTimestamp, ['pg/text']],
    ['pg/timestamptz', pgTimestamptz, ['pg/text']],
    ['pg/tsquery', pgTsquery, []],
  ])('%s casts from exactly the types the design names', (_id, type, sources) => {
    expect(sourcesOf(type)).toEqual(sources);
  });

  it('declares no list cast, because no type of this target holds several elements', () => {
    expect(postgresDataTypes.filter((type) => type.listCast !== undefined)).toEqual([]);
  });
});

describe('what each cast converts', () => {
  it.each([
    ['pg/int2 to pg/int4, a number either way', pgInt4, pgInt2.id, 42, 42],
    ['pg/int2 to pg/int8, a number to digit text', pgInt8, pgInt2.id, 42, '42'],
    ['pg/int4 to pg/int8, a number to digit text', pgInt8, pgInt4.id, -70000, '-70000'],
    ['pg/int2 to pg/numeric, a number to text', pgNumeric, pgInt2.id, 42, '42'],
    ['pg/int4 to pg/numeric, a number to text', pgNumeric, pgInt4.id, -70000, '-70000'],
    [
      'pg/int8 to pg/numeric, digit text unchanged',
      pgNumeric,
      pgInt8.id,
      '9007199254740993',
      '9007199254740993',
    ],
    ['pg/int2 to pg/float8, a number either way', pgFloat8, pgInt2.id, 42, 42],
    ['pg/int8 to pg/float8, digit text to a number', pgFloat8, pgInt8.id, '42', 42],
    ['pg/numeric to pg/float8, decimal text to a number', pgFloat8, pgNumeric.id, '1.50', 1.5],
    ['pg/numeric to pg/float8, a word stays a word', pgFloat8, pgNumeric.id, 'NaN', 'NaN'],
    [
      'pg/numeric to pg/float4, a word stays a word',
      pgFloat4,
      pgNumeric.id,
      '-Infinity',
      '-Infinity',
    ],
    ['pg/json to pg/jsonb, the document unchanged', pgJsonb, pgJson.id, { a: [1] }, { a: [1] }],
    ['pg/text to pg/uuid, the text unchanged', pgUuid, pgText.id, 'abc', 'abc'],
    [
      'pg/text to pg/timestamp, the text unchanged',
      pgTimestamp,
      pgText.id,
      '2020-01-01',
      '2020-01-01',
    ],
  ])('%s', (_name, type, source, value, converted) => {
    expect(type.casts[source]?.(value)).toEqual(converted);
  });

  it.each([
    ['a whole number too large for a double', '1'.padEnd(400, '0')],
    ['a negative number too large for a double', `-${'1'.padEnd(400, '0')}`],
  ])('refuses %s rather than rounding it to a word', (_name, text) => {
    expect(() => pgFloat8.casts[pgNumeric.id]?.(text)).toThrow(/out of range/);
  });

  it.each([
    ['from numeric text', pgNumeric.id, '3.5e38'],
    ['from a negative numeric text', pgNumeric.id, '-3.5e38'],
    ['from a whole number', pgInt8.id, '400000000000000000000000000000000000000'],
  ])('pg/float4 refuses a magnitude past a float32 %s', (_name, source, value) => {
    expect(() => pgFloat4.casts[source]?.(value)).toThrow(/out of range/);
  });

  it('pg/float8 takes a magnitude a float32 cannot hold', () => {
    expect(pgFloat8.casts[pgNumeric.id]?.('3.5e38')).toBe(3.5e38);
  });

  it.each([
    ['a value in a shape the source type does not store', pgInt8, pgInt2.id, 'not a number'],
    ['a magnitude no double holds', pgFloat8, pgNumeric.id, '1'.padEnd(400, '0')],
    ['a magnitude no float4 holds', pgFloat4, pgNumeric.id, '3.5e38'],
  ])('refuses %s with a cast-level code', (_name, type, source, value) => {
    expect(() => type.casts[source]?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });

  it.each([
    ['pg/int8, whose canonical form is digit text', pgInt8, pgInt2.id],
    ['pg/numeric, whose canonical form is text', pgNumeric, pgInt4.id],
  ])('refuses a value %s cannot have been handed', (_name, type, source) => {
    expect(() => type.casts[source]?.('not a number')).toThrow(/Expected a number/);
  });
});
