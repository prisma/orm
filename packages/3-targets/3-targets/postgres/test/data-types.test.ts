import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
import { SqlColumnDefaultIR } from '@internal/sql-schema-ir/types';
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

  it('declares no type that takes a sql/expression value through a cast or a list cast', () => {
    expect(
      postgresDataTypes.filter(
        (type) =>
          'sql/expression' in type.casts ||
          type.listCast?.of.includes(SQL_EXPRESSION_DATA_TYPE_ID) === true,
      ),
    ).toEqual([]);
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
    [
      'pg/text to pg/timestamp, the text to its canonical form',
      pgTimestamp,
      pgText.id,
      '2020-01-01 12:00:00',
      '2020-01-01T12:00:00',
    ],
    [
      'pg/text to pg/timestamptz, the instant in UTC',
      pgTimestamptz,
      pgText.id,
      '2020-01-01T01:00:00.000+01:00',
      '2020-01-01T00:00:00Z',
    ],
    ['pg/text to pg/date, a BC year signed', pgDate, pgText.id, '0044-03-15 BC', '-000043-03-15'],
    ['pg/text to pg/time, trailing zeros dropped', pgTime, pgText.id, '12:00:00.50', '12:00:00.5'],
    [
      'pg/text to pg/timetz, the offset in full',
      pgTimetz,
      pgText.id,
      '12:00:00+02',
      '12:00:00+02:00',
    ],
    ['pg/text to pg/interval, the ISO duration', pgInterval, pgText.id, '1 day', 'P1D'],
  ])('%s', (_name, type, source, value, converted) => {
    expect(type.casts[source]?.(value)).toEqual(converted);
  });

  it.each([
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
    '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
    'a0eebc999c0b4ef8bb6d6bb9bd380a11',
    'a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11',
  ])('pg/text to pg/uuid, %s to the form PostgreSQL writes', (text) => {
    expect(pgUuid.casts[pgText.id]?.(text)).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
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
    ['text that is not a UUID', pgUuid, pgText.id, 'not-a-uuid'],
    ['a UUID with a stray hyphen', pgUuid, pgText.id, 'a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11'],
    ['a value in a shape the source type does not store', pgInt8, pgInt2.id, 'not a number'],
    ['a magnitude no double holds', pgFloat8, pgNumeric.id, '1'.padEnd(400, '0')],
    ['a magnitude no float4 holds', pgFloat4, pgNumeric.id, '3.5e38'],
    ['a magnitude float4 rounds to 0', pgFloat4, pgNumeric.id, `0.${'0'.repeat(49)}1`],
    ['a date that does not exist', pgDate, pgText.id, '2024-02-30'],
    ['a timestamp with an offset', pgTimestamp, pgText.id, '2024-01-01T00:00:00Z'],
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

  it('pg/uuid names what it reads when it refuses text', () => {
    expect(() => pgUuid.casts[pgText.id]?.('nope')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message:
          '"nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.',
      }),
    );
  });
});

describe('the canonical form of pg/int8', () => {
  it.each([
    ['digit text', '9007199254740993', '9007199254740993'],
    ['digit text with leading zeros', '-007', '-7'],
    ['a safe integer, as PostgreSQL reads back a bigint default', 42, '42'],
    ['a negative safe integer', -1, '-1'],
  ])('reads %s as its digit text', (_name, value, canonical) => {
    expect(pgInt8.toCanonicalForm?.(value)).toBe(canonical);
  });

  it.each([
    ['a number past the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['a fraction', 1.5],
    ['text that is not an integer', '1.5'],
  ])('refuses %s with a cast-level code', (_name, value) => {
    expect(() => pgInt8.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });

  it('makes a default read back as a number equal its digit text, and not a number that lost digits', () => {
    const expected = (value: string | readonly string[]) =>
      new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value },
        nativeTypeContext: Array.isArray(value) ? 'int8[]' : 'int8',
        dataType: pgInt8,
      });
    const actual = (value: number | string | readonly number[]) =>
      new SqlColumnDefaultIR({ resolved: { kind: 'literal', value } });
    expect({
      safe: expected('42').isEqualTo(actual(42)),
      negative: expected('-7').isEqualTo(actual(-7)),
      past2To53: expected('9007199254740993').isEqualTo(actual('9007199254740993')),
      lostDigits: expected('9007199254740993').isEqualTo(actual(9007199254740992)),
      different: expected('1').isEqualTo(actual(2)),
      list: expected(['1', '-2']).isEqualTo(actual([1, -2])),
    }).toEqual({
      safe: true,
      negative: true,
      past2To53: true,
      lostDigits: false,
      different: false,
      list: true,
    });
  });
});
