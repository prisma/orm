import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'codec-strictness' };

describe('pg/vector@1 decodeJson', () => {
  const codec = pgVectorDescriptor.factory({ length: 3 })(ctx);

  it('reads an array of JSON numbers', () => {
    expect(codec.decodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it.each([
    ['digit text elements', ['1', '2', '3']],
    ['decimal text elements', ['1', '0.5', '-2.25']],
    ['one text element among numbers', [1, 2, '3']],
  ])('refuses %s', (_name, json) => {
    expect(() => codec.decodeJson(json)).toThrow('Vector value must contain only numbers');
  });
});
