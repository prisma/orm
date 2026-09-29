import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlFloatDescriptor } from '../src/ast/sql-codecs';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('sql/float@1 decodeJson', () => {
  const codec = sqlFloatDescriptor.factory()(ctx);

  it('reads a finite JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it('reads the text PostgreSQL writes for NaN and the infinities', () => {
    expect(['NaN', 'Infinity', '-Infinity'].map((json) => codec.decodeJson(json))).toEqual([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
    ['negative decimal text', '-1.50'],
    ['a boolean', true],
    ['null', null],
    ['an infinite number', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      'sql/float@1 JSON value must be a finite number or the text NaN, Infinity or -Infinity',
    );
  });
});
