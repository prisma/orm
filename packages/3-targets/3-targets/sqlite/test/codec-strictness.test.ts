import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteIntegerDescriptor,
  sqliteRealDescriptor,
} from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('sqlite/bigint@1 decodeJson', () => {
  const codec = sqliteBigintDescriptor.factory()(ctx);

  it('reads digit text', () => {
    expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
  });

  it.each([
    ['a whole JSON number', 42],
    ['a fractional JSON number', 1.5],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/bigint@1 database JSON value must be a decimal string',
    );
  });
});

describe('sqlite/bigintnumber@1 digit text', () => {
  const codec = sqliteBigintNumberDescriptor.factory()(ctx);

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
      'sqlite/bigintnumber@1 database JSON value must be decimal text',
    );
  });

  it.each([['9007199254740992'], ['-9007199254740992'], ['9007199254740993']])(
    'refuses the digit text %s, naming the limit',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    },
  );

  it('refuses decimal text', () => {
    expect(() => codec.decodeJson('1.5')).toThrow(
      'sqlite/bigintnumber@1 database JSON value must be decimal text',
    );
  });
});

describe('sqlite/integer@1 decodeJson', () => {
  const codec = sqliteIntegerDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
    ['a boolean', true],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/integer@1 database JSON value must be a number',
    );
  });

  it.each([
    ['a number with a fraction', 1.5],
    ['a number past the safe integer range', 9007199254740992],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/integer@1 value must be an integer within the safe integer range',
    );
  });
});

describe('sqlite/real@1 decodeJson', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
    ['the text NaN', 'NaN'],
    ['the text Infinity', 'Infinity'],
    ['the text -Infinity', '-Infinity'],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sqlite/real@1 database JSON value must be a number',
    );
  });
});
