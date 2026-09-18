import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'literal-defaults' };

describe('pg/vector@1 decodeJson', () => {
  const codec = pgVectorDescriptor.factory({ length: 3 })(ctx);

  it('reads an array of JSON numbers', () => {
    expect(codec.decodeJson([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });

  it('reads digit and decimal text elements', () => {
    expect(codec.decodeJson(['1', '0.5', '-2.25'])).toEqual([1, 0.5, -2.25]);
  });

  it('refuses an element that is not a numeral', () => {
    expect(() => codec.decodeJson([1, 2, 'x'])).toThrow();
  });

  it('refuses a non-finite element', () => {
    expect(() => codec.decodeJson([1, 2, 'NaN'])).toThrow();
  });

  it('refuses the wrong length', () => {
    expect(() => codec.decodeJson(['1', '2'])).toThrow('Vector length mismatch');
  });
});
