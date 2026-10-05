import type { JsonValue } from '@internal/contract/types';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
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

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('pg/int8@1 decodeJson', () => {
  const codec = pgInt8Descriptor.factory()(ctx);

  it('reads digit text', () => {
    expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'pg/int8@1 JSON value must be a decimal integer string from -9223372036854775808 to 9223372036854775807',
    );
  });
});

describe('pg/unboundedint@1 decodeJson', () => {
  const codec = pgUnboundedIntDescriptor.factory()(ctx);

  it('reads digit text past the int8 range', () => {
    expect(codec.decodeJson('9223372036854775808')).toBe(9223372036854775808n);
  });

  it('refuses a JSON number', () => {
    expect(() => codec.decodeJson(-7)).toThrow(
      'pg/unboundedint@1 JSON value must be a decimal integer string',
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
    expect(codec.encodeJson(value)).toBe(text);
    expect(codec.decodeJson(text)).toBe(value);
  });

  it('refuses a JSON number', () => {
    expect(() => codec.decodeJson(42)).toThrow(
      'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992'], ['9007199254740993']])(
    'refuses the digit text %s, naming the limit',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
      );
    },
  );

  it('refuses decimal text', () => {
    expect(() => codec.decodeJson('1.5')).toThrow(
      'pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991',
    );
  });
});

describe.each([
  ['pg/int8@1', () => pgInt8Descriptor.factory()(ctx), (value: bigint) => value],
  [
    'pg/int8number@1',
    () => pgInt8NumberDescriptor.factory()(ctx),
    (value: bigint) => Number(value),
  ],
  ['pg/unboundedint@1', () => pgUnboundedIntDescriptor.factory()(ctx), (value: bigint) => value],
])('%s digit text as PostgreSQL prints it', (codecId, build, applicationValue) => {
  const codec: { encodeJson(value: never): JsonValue; decodeJson(json: JsonValue): unknown } =
    build();

  it.each([
    ['a leading zero', '007', '7'],
    ['a negative zero', '-0', '0'],
    ['a negative number with a leading zero', '-007', '-7'],
    ['two zeros', '00', '0'],
  ])('refuses %s, naming the text PostgreSQL prints for the value', (_name, json, printed) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `${codecId} JSON value must be "${printed}", as PostgreSQL writes this value`,
    );
  });

  it('writes digit text without leading zeros or a minus sign on zero', () => {
    expect(
      [0n, 7n, -7n].map((value) => codec.encodeJson(applicationValue(value) as never)),
    ).toEqual(['0', '7', '-7']);
  });
});

describe('pg/numeric@1 decodeJson', () => {
  const codec = pgNumericDescriptor.factory({})(ctx);

  it('reads decimal text as written', () => {
    expect(codec.decodeJson('1.50')).toBe('1.50');
  });

  it.each([
    ['a leading zero', '01.5', '1.5'],
    ['a negative zero', '-0', '0'],
    ['a negative zero with a fraction', '-0.00', '0.00'],
  ])('refuses %s, naming the text PostgreSQL prints for the value', (_name, json, printed) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `pg/numeric@1 JSON value must be "${printed}", as PostgreSQL writes this value`,
    );
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'pg/numeric@1 JSON value must be a decimal string',
    );
  });
});

describe('pg/inet@1 decodeJson', () => {
  const codec = pgInetDescriptor.factory()(ctx);

  it.each([
    ['an IPv4 host with /32', '10.0.0.1/32', '10.0.0.1'],
    ['an IPv6 host with /128', '::1/128', '::1'],
    ['upper-case hex', '::FFFF:10.0.0.1', '::ffff:10.0.0.1'],
    ['zeros Postgres compresses', '2001:db8:0:0:0:0:0:1', '2001:db8::1'],
  ])('refuses %s, naming the text PostgreSQL prints for the address', (_name, json, printed) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `pg/inet@1 JSON value must be "${printed}", as PostgreSQL writes this address`,
    );
  });

  it('refuses text that is not an address', () => {
    expect(() => codec.decodeJson('not an address')).toThrow(
      'pg/inet@1 JSON value must be an IP address as PostgreSQL writes it',
    );
  });
});

describe.each([
  ['pg/float4@1', pgFloat4Descriptor],
  ['pg/float8@1', pgFloat8Descriptor],
])('%s decodeJson', (codecId, descriptor) => {
  const codec = descriptor.factory()(ctx);

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('round-trips the non-finite word %s', (text, value) => {
    expect(codec.encodeJson(value)).toBe(text);
    expect(codec.decodeJson(text)).toBe(value);
  });

  it('keeps a finite value as a JSON number', () => {
    expect(codec.encodeJson(1.5)).toBe(1.5);
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `${codecId} JSON value must be a finite number or the text NaN, Infinity or -Infinity`,
    );
  });
});

describe('pg/float@1 decodeJson', () => {
  const codec = pgFloatDescriptor.factory()(ctx);

  it.each([['42'], ['1.5']])('refuses the text %s', (json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'pg/float@1 JSON value must be a finite number or the text NaN, Infinity or -Infinity',
    );
  });

  it('reads the text PostgreSQL writes for NaN and the infinities', () => {
    expect(['NaN', 'Infinity', '-Infinity'].map((json) => codec.decodeJson(json))).toEqual([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });
});
