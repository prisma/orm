import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
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
      'pg/int8@1 database JSON value must be a decimal string',
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
      'pg/unboundedint@1 database JSON value must be a decimal string',
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
      'pg/int8number@1 database JSON value must be decimal text',
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992'], ['9007199254740993']])(
    'refuses the digit text %s, naming the limit',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        'pg/int8number@1 value must be an integer within the safe integer range',
      );
    },
  );

  it('refuses decimal text', () => {
    expect(() => codec.decodeJson('1.5')).toThrow(
      'pg/int8number@1 value must be a decimal integer',
    );
  });
});

describe('pg/numeric@1 decodeJson', () => {
  const codec = pgNumericDescriptor.factory({})(ctx);

  it('reads decimal text as written', () => {
    expect(codec.decodeJson('1.50')).toBe('1.50');
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'pg/numeric@1 database JSON value must be a decimal string',
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
      `${codecId} database JSON value must be a number or the text NaN, Infinity or -Infinity`,
    );
  });
});

describe('pg/float@1 decodeJson', () => {
  const codec = pgFloatDescriptor.factory()(ctx);

  it.each([['42'], ['1.5'], ['NaN'], ['Infinity'], ['-Infinity']])(
    'refuses the text %s',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        `Expected a finite number for sql/float@1, got ${JSON.stringify(json)}`,
      );
    },
  );
});
