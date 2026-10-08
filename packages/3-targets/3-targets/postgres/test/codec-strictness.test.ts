import type {
  CodecInstanceContext,
  DataType,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInetDescriptor,
  pgInt8Descriptor,
  pgInt8NumberDescriptor,
  pgNumericDescriptor,
  pgUnboundedIntDescriptor,
} from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('pg/int8@1 contract JSON', () => {
  const codec = pgInt8Descriptor.factory()(ctx);

  it('reads digit text', () => {
    expect(fromContractJson(codec, '9007199254740993')).toBe(9007199254740993n);
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      'pg/int8 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });
});

describe('pg/unboundedint@1 contract JSON', () => {
  const codec = pgUnboundedIntDescriptor.factory()(ctx);

  it('reads digit text past the int8 range', () => {
    expect(fromContractJson(codec, '9223372036854775808')).toBe(9223372036854775808n);
  });

  it('refuses a JSON number', () => {
    expect(() => fromContractJson(codec, -7)).toThrow(
      'pg/numeric JSON value must be a decimal string',
    );
  });
});

describe('pg/int8number@1 digit text', () => {
  const codec = pgInt8NumberDescriptor.factory()(ctx);

  it.each([
    ['a positive value', 42, '42'],
    ['a negative value', -42, '-42'],
    ['the top of the safe integer range', 9007199254740991, '9007199254740991'],
  ])('round-trips %s as digit text', (_name, value, text) => {
    expect(toContractJson(codec, value)).toBe(text);
    expect(fromContractJson(codec, text)).toBe(value);
  });

  it('refuses a JSON number', () => {
    expect(() => fromContractJson(codec, 42)).toThrow(
      'pg/int8 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992'], ['9007199254740993']])(
    'refuses the digit text %s, naming the limit',
    (json) => {
      expect(() => fromContractJson(codec, json)).toThrow(
        'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
      );
    },
  );

  it('refuses decimal text', () => {
    expect(() => fromContractJson(codec, '1.5')).toThrow(
      'pg/int8 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });
});

const int8Refusal = (printed: string) =>
  `pg/int8 JSON value must be "${printed}", the integer's decimal text without leading zeros or a minus sign on zero`;

describe.each([
  ['pg/int8@1', () => pgInt8Descriptor.factory()(ctx), (value: bigint) => value, int8Refusal],
  [
    'pg/int8number@1',
    () => pgInt8NumberDescriptor.factory()(ctx),
    (value: bigint) => Number(value),
    int8Refusal,
  ],
  [
    'pg/unboundedint@1',
    () => pgUnboundedIntDescriptor.factory()(ctx),
    (value: bigint) => value,
    (printed: string) =>
      `pg/numeric JSON value must be "${printed}", as PostgreSQL writes this value`,
  ],
])('%s digit text as PostgreSQL prints it', (_codecId, build, applicationValue, refusal) => {
  const codec: {
    readonly dataType: DataType;
    toDataTypeValue(input: never): DataTypeValue;
    fromDataTypeValue(value: DataTypeValue): unknown;
  } = build();

  it.each([
    ['a leading zero', '007', '7'],
    ['a negative zero', '-0', '0'],
    ['a negative number with a leading zero', '-007', '-7'],
    ['two zeros', '00', '0'],
  ])('refuses %s, naming the text PostgreSQL prints for the value', (_name, json, printed) => {
    expect(() => fromContractJson(codec, json)).toThrow(refusal(printed));
  });

  it('writes digit text without leading zeros or a minus sign on zero', () => {
    expect(
      [0n, 7n, -7n].map((value) => toContractJson(codec, applicationValue(value) as never)),
    ).toEqual(['0', '7', '-7']);
  });
});

describe('pg/numeric@1 contract JSON', () => {
  const codec = pgNumericDescriptor.factory({})(ctx);

  it('reads decimal text as written', () => {
    expect(fromContractJson(codec, '1.50')).toBe('1.50');
  });

  it.each([
    ['a leading zero', '01.5', '1.5'],
    ['a negative zero', '-0', '0'],
    ['a negative zero with a fraction', '-0.00', '0.00'],
  ])('refuses %s, naming the text PostgreSQL prints for the value', (_name, json, printed) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      `pg/numeric JSON value must be "${printed}", as PostgreSQL writes this value`,
    );
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      'pg/numeric JSON value must be a decimal string',
    );
  });
});

describe('pg/inet@1 contract JSON', () => {
  const codec = pgInetDescriptor.factory()(ctx);

  it.each([
    ['an IPv4 host with /32', '10.0.0.1/32', '10.0.0.1'],
    ['an IPv6 host with /128', '::1/128', '::1'],
    ['upper-case hex', '::FFFF:10.0.0.1', '::ffff:10.0.0.1'],
    ['zeros Postgres compresses', '2001:db8:0:0:0:0:0:1', '2001:db8::1'],
  ])('refuses %s, naming the text PostgreSQL prints for the address', (_name, json, printed) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      `pg/inet JSON value must be "${printed}", as PostgreSQL writes this address`,
    );
  });

  it('refuses text that is not an address', () => {
    expect(() => fromContractJson(codec, 'not an address')).toThrow(
      'pg/inet JSON value must be an IP address as PostgreSQL writes it',
    );
  });
});

describe.each([
  ['pg/float4@1', pgFloat4Descriptor, 'pg/float4'],
  ['pg/float8@1', pgFloat8Descriptor, 'pg/float8'],
])('%s contract JSON', (_codecId, descriptor, dataTypeId) => {
  const codec = descriptor.factory()(ctx);

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('round-trips the non-finite word %s', (text, value) => {
    expect(toContractJson(codec, value)).toBe(text);
    expect(fromContractJson(codec, text)).toBe(value);
  });

  it('keeps a finite value as a JSON number', () => {
    expect(toContractJson(codec, 1.5)).toBe(1.5);
    expect(fromContractJson(codec, 1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
  ])('refuses %s', (_name, json) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      `${dataTypeId} JSON value must be a finite number or the text NaN, Infinity or -Infinity`,
    );
  });
});

describe('pg/float@1 contract JSON', () => {
  const codec = pgFloatDescriptor.factory()(ctx);

  it.each([['42'], ['1.5']])('refuses the text %s', (json) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      'pg/float8 JSON value must be a finite number or the text NaN, Infinity or -Infinity',
    );
  });

  it('reads the text PostgreSQL writes for NaN and the infinities', () => {
    expect(['NaN', 'Infinity', '-Infinity'].map((json) => fromContractJson(codec, json))).toEqual([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });
});
