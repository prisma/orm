import { dataTypeValuesEqual } from '@internal/framework-components/codec';
import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
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
  pgMoney,
  pgNumeric,
  pgOid,
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
  pgXml,
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
      'pg/money',
      'pg/numeric',
      'pg/oid',
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
      'pg/xml',
      'sql/raw',
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
    ['pg/xml', pgXml, ['pg/text']],
    ['pg/oid', pgOid, ['pg/int2', 'pg/int4', 'pg/int8']],
    ['pg/money', pgMoney, ['pg/int2', 'pg/int4', 'pg/int8', 'pg/numeric']],
    ['pg/timetz', pgTimetz, []],
    ['pg/interval', pgInterval, []],
    ['pg/bytea', pgBytea, []],
    ['pg/date', pgDate, []],
    ['pg/time', pgTime, []],
    ['pg/timestamp', pgTimestamp, []],
    ['pg/timestamptz', pgTimestamptz, []],
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
    ['an IPv4 host with /32', '10.0.0.1/32', '10.0.0.1'],
    ['an upper-case IPv4-mapped address', '::FFFF:10.0.0.1', '::ffff:10.0.0.1'],
    ['an IPv6 address written in full', '2001:0DB8:0:0:0:0:0:1/64', '2001:db8::1/64'],
    ['an IPv4 network', '10.0.0.0/8', '10.0.0.0/8'],
  ])('pg/text to pg/inet, %s to the form PostgreSQL writes', (_name, text, printed) => {
    expect(pgInet.casts[pgText.id]?.(text)).toBe(printed);
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
    ['text that is not an address', pgInet, pgText.id, 'not an address'],
    ['an IPv4 prefix past 32', pgInet, pgText.id, '10.0.0.1/33'],
    ['a value in a shape the source type does not store', pgInt8, pgInt2.id, 'not a number'],
    ['a magnitude no double holds', pgFloat8, pgNumeric.id, '1'.padEnd(400, '0')],
    ['a magnitude no float4 holds', pgFloat4, pgNumeric.id, '3.5e38'],
    ['a magnitude float4 rounds to 0', pgFloat4, pgNumeric.id, `0.${'0'.repeat(49)}1`],
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

  it('pg/inet names what it reads when it refuses text', () => {
    expect(() => pgInet.casts[pgText.id]?.('nope')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message:
          '"nope" is not an IP address: PostgreSQL reads an IPv4 address in decimal octets or an IPv6 address in hexadecimal groups, either optionally followed by / and a prefix length.',
      }),
    );
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

describe('the equality of pg/numeric values', () => {
  it('holds values equal that differ only in scale, and every other type has no key of its own', () => {
    expect({
      numeric: ['0.50', '0.5', '-0'].map((json) => pgNumeric.equalityKey?.(json)),
      keyed: postgresDataTypes
        .filter((type) => type.equalityKey !== undefined)
        .map((type) => type.id),
    }).toEqual({ numeric: ['0.5', '0.5', '0'], keyed: ['pg/numeric', 'pg/interval'] });
  });

  it('holds intervals equal by their total length, a month counting as 30 days and a day as 24 hours, as PostgreSQL compares them', () => {
    const key = (json: string) => pgInterval.equalityKey?.(json);
    expect({
      dayAndHours: key('P1D') === key('PT24H'),
      monthAndDays: key('P1M') === key('P30D'),
      yearAndMonths: key('P1Y') === key('P12M'),
      mixed: key('P1DT1H') === key('PT25H'),
      different: key('P1D') === key('P2D'),
      fraction: key('PT0.5S') === key('PT0.500S'),
    }).toEqual({
      dayAndHours: true,
      monthAndDays: true,
      yearAndMonths: true,
      mixed: true,
      different: false,
      fraction: true,
    });
  });
});

describe("each codec's equality-key flag", () => {
  it('is declared by the codecs whose application value keeps the forms its data type holds equal, and only on a data type with an equality key', async () => {
    const { codecDescriptors } = await import('../src/core/codecs');
    const types = new Map(postgresDataTypes.map((type) => [type.id, type]));
    const flagged = codecDescriptors.filter((descriptor) => descriptor.keepsWrittenForm === true);
    expect({
      flagged: flagged.map((descriptor) => descriptor.codecId),
      withoutKey: flagged
        .filter((descriptor) => types.get(descriptor.dataType)?.equalityKey === undefined)
        .map((descriptor) => descriptor.codecId),
    }).toEqual({
      flagged: ['pg/numeric@1', 'pg/interval@1', 'pg/interval-string@1'],
      withoutKey: [],
    });
  });

  it('is declared only by codecs that render no literal, since a read can return a member in another form', async () => {
    const { codecDescriptors } = await import('../src/core/codecs');
    expect(
      codecDescriptors
        .filter((descriptor) => descriptor.keepsWrittenForm === true)
        .filter((descriptor) => descriptor.renderValueLiteral !== undefined)
        .map((descriptor) => descriptor.codecId),
    ).toEqual([]);
  });
});

describe('values under parameters with one normal form', () => {
  it('are one value for numeric(10) and numeric(10,0)', () => {
    const short = pgNumeric.valueFrom('12', { precision: 10 });
    const long = pgNumeric.fromContract('12', { precision: 10, scale: 0 });
    expect({ params: short.params, equal: dataTypeValuesEqual(short, long) }).toEqual({
      params: { precision: 10, scale: 0 },
      equal: true,
    });
  });

  it('are one value for character and character(1)', () => {
    expect(
      dataTypeValuesEqual(pgChar.valueFrom('a', {}), pgChar.fromContract('a', { length: 1 })),
    ).toBe(true);
  });
});
