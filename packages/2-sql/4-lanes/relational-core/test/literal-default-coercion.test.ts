import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlFloatDescriptor } from '../src/ast/sql-codecs';

const ctx: CodecInstanceContext = { name: 'literal-defaults' };

describe('sql/float@1 decodeJson', () => {
  const codec = sqlFloatDescriptor.factory()(ctx);

  it('reads a JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42', 42],
    ['decimal text', '1.5', 1.5],
    ['negative decimal text', '-1.50', -1.5],
  ])('reads %s', (_name, json, expected) => {
    expect(codec.decodeJson(json)).toBe(expected);
  });

  it('refuses numeral text whose magnitude overflows to Infinity', () => {
    expect(() => codec.decodeJson(`${'9'.repeat(400)}.5`)).toThrow();
    expect(() => codec.decodeJson(`-${'9'.repeat(400)}`)).toThrow();
  });

  it.each([['NaN'], ['Infinity'], ['-Infinity'], ['nonsense'], ['']])(
    'refuses the text %o',
    (json) => {
      expect(() => codec.decodeJson(json)).toThrow();
    },
  );

  it.each([
    ['a boolean', true],
    ['null', null],
    ['a non-finite number', Number.NaN],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});
