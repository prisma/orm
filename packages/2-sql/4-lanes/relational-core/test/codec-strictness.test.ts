import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlFloatDescriptor } from '../src/ast/sql-codecs';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('sql/float@1 decodeJson', () => {
  const codec = sqlFloatDescriptor.factory()(ctx);

  it('reads a finite JSON number', () => {
    expect(codec.decodeJson(1.5)).toBe(1.5);
  });

  it.each([
    ['digit text', '42'],
    ['decimal text', '1.5'],
    ['negative decimal text', '-1.50'],
    ['the text NaN', 'NaN'],
    ['the text Infinity', 'Infinity'],
    ['the text -Infinity', '-Infinity'],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      `Expected a finite number for sql/float@1, got ${JSON.stringify(json)}`,
    );
  });

  it.each([
    ['a boolean', true],
    ['null', null],
    ['a non-finite number', Number.NaN],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow();
  });
});
