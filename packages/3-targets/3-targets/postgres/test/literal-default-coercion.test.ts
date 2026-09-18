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

const ctx: CodecInstanceContext = { name: 'literal-defaults' };

describe('pg/int8@1 decodeJson', () => {
  const codec = pgInt8Descriptor.factory()(ctx);

  it('reads the digit text of an i64 literal', () => {
    expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
  });

  it('reads the JSON number of a small whole-number literal', () => {
    expect(codec.decodeJson(42)).toBe(42n);
  });

  it.each([
    ['a fractional number', 1.5],
    ['a number past the safe integer range', 9007199254740992],
    ['text that is not a decimal integer', '1.5'],
    ['a boolean', true],
    ['null', null],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('pg/unboundedint@1 decodeJson', () => {
  const codec = pgUnboundedIntDescriptor.factory()(ctx);

  it('reads digit text past the int8 range', () => {
    expect(codec.decodeJson('9223372036854775808')).toBe(9223372036854775808n);
  });

  it('reads a JSON number', () => {
    expect(codec.decodeJson(-7)).toBe(-7n);
  });

  it.each([
    ['a fractional number', 1.5],
    ['a number past the safe integer range', 9007199254740992],
    ['decimal text', '1.5'],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('pg/int8number@1 decodeJson', () => {
  const codec = pgInt8NumberDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42);
  });

  it('reads digit text within the safe integer range', () => {
    expect(codec.decodeJson('9007199254740991')).toBe(9007199254740991);
  });

  it('refuses digit text past the safe integer range, naming the limit', () => {
    expect(() => codec.decodeJson('9007199254740992')).toThrow(
      'pg/int8number@1 value must be an integer within the safe integer range',
    );
  });

  it.each([
    ['decimal text', '1.5'],
    ['a fractional number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('pg/numeric@1 decodeJson', () => {
  const codec = pgNumericDescriptor.factory({})(ctx);

  it('reads decimal text as written', () => {
    expect(codec.decodeJson('1.50')).toBe('1.50');
  });

  it.each([
    ['a whole JSON number', 42, '42'],
    ['a fractional JSON number', 1.5, '1.5'],
  ])('reads %s as canonical decimal text', (_name, json, expected) => {
    expect(codec.decodeJson(json)).toBe(expected);
  });

  it.each([
    ['a boolean', true],
    ['null', null],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe.each([
  ['pg/float4@1', pgFloat4Descriptor],
  ['pg/float8@1', pgFloat8Descriptor],
])('%s non-finite values and literal shapes', (_id, descriptor) => {
  const codec = descriptor.factory()(ctx);

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('round-trips %s through encodeJson and decodeJson', (text, value) => {
    expect(codec.encodeJson(value)).toBe(text);
    expect(codec.decodeJson(codec.encodeJson(value))).toBe(value);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('round-trips %s through encode and decode', async (text, value) => {
    expect(await codec.encode(value, {})).toBe(text);
    expect(await codec.decode(text, {})).toBe(value);
  });

  it('keeps a finite value as a JSON number', () => {
    expect(codec.encodeJson(1.5)).toBe(1.5);
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42', 42],
    ['decimal text', '1.5', 1.5],
  ])('reads %s', (_name, json, expected) => {
    expect(codec.decodeJson(json)).toBe(expected);
  });

  it.each([
    ['text that is not a numeral', 'nonsense'],
    ['a boolean', true],
    ['null', null],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('pg/float@1 decodeJson', () => {
  const codec = pgFloatDescriptor.factory()(ctx);

  it.each([
    ['digit text', '42', 42],
    ['decimal text', '1.5', 1.5],
  ])('reads %s', (_name, json, expected) => {
    expect(codec.decodeJson(json)).toBe(expected);
  });

  it.each([['NaN'], ['Infinity'], ['-Infinity']])('refuses the non-finite word %s', (json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});
