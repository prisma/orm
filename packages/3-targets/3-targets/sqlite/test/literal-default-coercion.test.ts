import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteIntegerDescriptor,
  sqliteRealDescriptor,
} from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'literal-defaults' };

describe('sqlite/bigint@1 decodeJson', () => {
  const codec = sqliteBigintDescriptor.factory()(ctx);

  it('reads digit text', () => {
    expect(codec.decodeJson('9007199254740993')).toBe(9007199254740993n);
  });

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42n);
  });

  it.each([
    ['a fractional number', 1.5],
    ['a number past the safe integer range', 9007199254740992],
    ['decimal text', '1.5'],
    ['a boolean', true],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('sqlite/bigintnumber@1 decodeJson', () => {
  const codec = sqliteBigintNumberDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42);
  });

  it('reads digit text within the safe integer range', () => {
    expect(codec.decodeJson('9007199254740991')).toBe(9007199254740991);
  });

  it('refuses digit text past the safe integer range, naming the limit', () => {
    expect(() => codec.decodeJson('9007199254740992')).toThrow('safe integer range');
  });
});

describe('sqlite/integer@1 decodeJson', () => {
  const codec = sqliteIntegerDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(42)).toBe(42);
  });

  it('reads digit text within the safe integer range', () => {
    expect(codec.decodeJson('9007199254740991')).toBe(9007199254740991);
  });

  it.each([
    ['a number past the safe integer range', 9007199254740992],
    ['digit text past the safe integer range', '9007199254740992'],
  ])('refuses %s, naming the limit', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow('safe integer range');
  });

  it.each([
    ['a fractional number', 1.5],
    ['decimal text', '1.5'],
    ['a boolean', true],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});

describe('sqlite/real@1 decodeJson', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  it.each([
    ['digit text', '42', 42],
    ['decimal text', '1.5', 1.5],
  ])('reads %s', (_name, json, expected) => {
    expect(codec.decodeJson(json)).toBe(expected);
  });

  it('reads a JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it('refuses numeral text whose magnitude overflows to Infinity', () => {
    expect(() => codec.decodeJson(`${'9'.repeat(400)}.5`)).toThrow();
    expect(() => codec.decodeJson(`-${'9'.repeat(400)}`)).toThrow();
  });

  it.each([['NaN'], ['Infinity'], ['-Infinity']])('refuses the non-finite word %s', (json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});
