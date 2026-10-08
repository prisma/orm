import type { DataType } from '@internal/framework-components/codec';
import { dataTypeValueFor, readContractValue } from '@internal/framework-components/codec';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { pgInt8NumberDescriptor, pgNumericDescriptor } from '../src/core/codecs';
import {
  pgBit,
  pgChar,
  pgDate,
  pgFloat4,
  pgInt2,
  pgInt4,
  pgInterval,
  pgNumeric,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgVarbit,
  pgVarchar,
} from '../src/core/data-types';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';
import { setFallbackTemporal } from '../src/core/require-temporal';
import { pgTimestamptzTemporalDescriptor } from '../src/core/temporal-codecs';

setFallbackTemporal(Temporal);

const ctx = { name: 'data-type-readers' };

const refusedBy = (owner: Record<string, string>) =>
  expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED', meta: expect.objectContaining(owner) });

function read(type: DataType, json: unknown, params: Readonly<Record<string, unknown>> = {}) {
  return () => type.fromContract(json as never, params);
}

describe('the date and time types read ISO 8601 and the text PostgreSQL prints, and nothing else', () => {
  it.each([
    [pgDate, 'a date and time on a date column', '2024-01-01T10:00:00'],
    [pgDate, 'a date written without hyphens', '20240101'],
    [pgTime, 'a time without seconds', '10:00'],
    [pgTime, 'nine fraction digits', '10:00:00.123456789'],
    [pgTimestamp, 'a time without seconds', '2024-01-01T10:00'],
    [pgTimestamp, 'nine fraction digits', '2024-01-01T10:00:00.123456789'],
    [pgTimestamptz, 'a time without seconds', '2024-01-01T00:00Z'],
    [pgTimestamptz, 'an offset without a colon', '2024-01-01T00:00:00+0530'],
    [pgTimestamptz, 'nine fraction digits', '2024-01-01T00:00:00.123456789Z'],
  ])('%s refuses %s', (type, _form, text) => {
    expect(read(type, text)).toThrow(refusedBy({ dataType: type.id }));
  });

  it.each([
    [pgDate, '2024-01-01'],
    [pgDate, '0044-03-15 BC'],
    [pgDate, 'infinity'],
    [pgTime, '24:00:00'],
    [pgTimestamp, '2024-01-01 10:00:00.5'],
    [pgTimestamptz, '2024-01-01T00:00:00Z'],
    [pgTimestamptz, '2024-01-15 01:00:00+01'],
  ])('%s reads %s', (type, text) => {
    expect(type.fromContract(text, {}).value).toBe(text);
  });

  it('a Temporal codec no longer reads a form only Temporal.from took', () => {
    const codec = pgTimestamptzTemporalDescriptor.factory({})(ctx);
    expect(() => readContractValue(codec, '2024-01-01T00:00Z', {})).toThrow(
      refusedBy({ dataType: 'pg/timestamptz' }),
    );
  });

  it('a Date codec refuses infinity, which no Date holds', () => {
    const codec = pgTimestamptzDateDescriptor.factory({})(ctx);
    expect(() => readContractValue(codec, 'infinity', {})).toThrow(
      refusedBy({ codecId: 'pg/timestamptz-date@1' }),
    );
  });

  it('a Date codec reads the text PostgreSQL prints in another time zone', () => {
    const codec = pgTimestamptzDateDescriptor.factory({})(ctx);
    expect(readContractValue(codec, '2024-01-15 01:00:00+01', {})).toEqual(
      new Date('2024-01-15T00:00:00Z'),
    );
  });
});

describe('a type checks the limits of its parameters and its range', () => {
  it.each([
    ['pg/int4 above its range', pgInt4, 2 ** 31, {}],
    ['pg/int2 above its range', pgInt2, 32768, {}],
    ['a bare character, which is character(1), with two characters', pgChar, 'ab', {}],
    ['character(3) with four characters', pgChar, 'abcd', { length: 3 }],
    ['character varying(3) with four characters', pgVarchar, 'abcd', { length: 3 }],
    ['numeric(10, 2) with a third fraction digit', pgNumeric, '1.234', { precision: 10, scale: 2 }],
    [
      'numeric(10, 2) with nine whole digits',
      pgNumeric,
      '123456789.5',
      { precision: 10, scale: 2 },
    ],
    ['bit(3) with two bits', pgBit, '01', { length: 3 }],
    ['bit varying(2) with three bits', pgVarbit, '011', { length: 2 }],
    ['float4 past its range', pgFloat4, 1e39, {}],
  ])('refuses %s', (_case, type, json, params) => {
    expect(read(type, json, params)).toThrow(refusedBy({ dataType: type.id }));
  });

  it.each([
    [pgChar, 'abc', { length: 3 }],
    [pgVarchar, 'abc', { length: 3 }],
    [pgVarchar, 'any length', {}],
    [pgNumeric, '12345678.12', { precision: 10, scale: 2 }],
  ])('%s reads %j under %j', (type, json, params) => {
    expect(type.fromContract(json, params).value).toBe(json);
  });
});

describe('numeric(precision, scale) spells a value with its scale', () => {
  it.each([
    ['1.5', { precision: 10, scale: 2 }, '1.50'],
    ['7', { precision: 10, scale: 2 }, '7.00'],
    ['2.0', { precision: 10, scale: 0 }, '2'],
    ['2.0', { precision: 10 }, '2'],
    ['NaN', { precision: 10, scale: 2 }, 'NaN'],
    ['1.5', {}, '1.5'],
  ])('%s under %j is %s', (json, params, spelled) => {
    expect(pgNumeric.withParams(pgNumeric.fromContract(json, {}), params).value).toBe(spelled);
  });

  it("a numeric codec's value takes the codec's parameters", () => {
    const codec = pgNumericDescriptor.factory({ precision: 10, scale: 2 })(ctx);
    const value = codec.toDataTypeValue('1.5');
    expect({ type: value.type, params: value.params, value: value.value }).toEqual({
      type: 'pg/numeric',
      params: { precision: 10, scale: 2 },
      value: '1.50',
    });
  });

  it('a numeric codec refuses a value its parameters exclude rather than rounding it', () => {
    const codec = pgNumericDescriptor.factory({ precision: 10, scale: 2 })(ctx);
    expect(() => codec.toDataTypeValue('1.234')).toThrow(refusedBy({ dataType: 'pg/numeric' }));
  });
});

describe("a codec checks only its application value's own limits", () => {
  it('pg/int8number@1 refuses digit text past 2^53, which pg/int8 holds', () => {
    const codec = pgInt8NumberDescriptor.factory()(ctx);
    const digits = String(2n ** 53n);
    expect(() => readContractValue(codec, digits, {})).toThrow(
      refusedBy({ codecId: 'pg/int8number@1' }),
    );
  });
});

describe('a fractional-second precision limits a value, which the type refuses rather than rounds', () => {
  it.each([
    [pgTime, '00:00:00.5', { precision: 0 }],
    [pgTime, '00:00:00.1234', { precision: 3 }],
    [pgTimetz, '00:00:00.5+02:00', { precision: 0 }],
    [pgTimestamp, '2024-01-01T00:00:00.05', { precision: 1 }],
    [pgTimestamptz, '2024-01-01T00:00:00.5Z', { precision: 0 }],
    [pgTimestamptz, '2024-01-15 01:00:00.25+01', { precision: 1 }],
    [pgInterval, 'PT1.5S', { precision: 0 }],
  ])('%s refuses %s under %j', (type, text, params) => {
    expect(read(type, text, params)).toThrow(refusedBy({ dataType: type.id }));
  });

  it.each([
    [pgTime, '00:00:00.5', { precision: 1 }],
    [pgTime, '00:00:00', { precision: 0 }],
    [pgTimestamptz, '2024-01-01T00:00:00.123Z', { precision: 3 }],
    [pgTimestamptz, 'infinity', { precision: 0 }],
    [pgInterval, 'PT1.5S', { precision: 1 }],
    [pgInterval, 'P1Y', { precision: 0 }],
  ])('%s reads %s under %j', (type, text, params) => {
    expect(type.fromContract(text, params).value).toBe(text);
  });

  it('withParams refuses a value with more fraction digits than the precision', () => {
    expect(() =>
      pgTime.withParams(pgTime.fromContract('00:00:00.5', {}), { precision: 0 }),
    ).toThrow(refusedBy({ dataType: 'pg/time' }));
  });
});

describe('a character value is spelled without the spaces that pad it to its length', () => {
  it('refuses a padded value, naming the value without the padding', () => {
    expect(read(pgChar, 'a  ', { length: 3 })).toThrow(
      expect.objectContaining({
        message: 'pg/char JSON value must be "a", the spelling its parameters give this value',
      }),
    );
  });

  it('a value a codec hands over drops the padding', () => {
    expect(dataTypeValueFor(pgChar, { length: 3 }, 'a  ').value).toBe('a');
  });
});

describe('a numeric(precision, scale) value has one spelling', () => {
  it('refuses a value without the fraction digits its scale gives, naming the spelling', () => {
    expect(read(pgNumeric, '1.5', { precision: 10, scale: 2 })).toThrow(
      expect.objectContaining({
        message:
          'pg/numeric JSON value must be "1.50", the spelling its parameters give this value',
        meta: { dataType: 'pg/numeric', received: '"1.5"' },
      }),
    );
  });

  it('reads the value with its scale', () => {
    expect(pgNumeric.fromContract('1.50', { precision: 10, scale: 2 }).value).toBe('1.50');
  });
});

describe('an interval with no precision holds microseconds', () => {
  it('refuses a seventh fraction digit of a second', () => {
    expect(read(pgInterval, 'PT1.1234567S', {})).toThrow(refusedBy({ dataType: 'pg/interval' }));
  });

  it('refuses a seventh fraction digit in a value a codec hands over', () => {
    expect(() => dataTypeValueFor(pgInterval, {}, 'PT1.1234567S')).toThrow(
      refusedBy({ dataType: 'pg/interval' }),
    );
  });

  it('reads six fraction digits', () => {
    expect(pgInterval.fromContract('PT1.123456S', {}).value).toBe('PT1.123456S');
  });
});
