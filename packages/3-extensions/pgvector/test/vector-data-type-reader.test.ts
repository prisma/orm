import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';
import { pgvectorVector } from '../src/core/data-types';

describe('pgvector/vector reads the array of numbers it stores', () => {
  it('reads as many finite numbers as its length', () => {
    expect(pgvectorVector.fromContract([1, 2, 3], { length: 3 }).value).toEqual([1, 2, 3]);
  });

  it.each([
    ['four numbers on vector(3)', [1, 2, 3, 4]],
    ['a number that is not finite', [1, 2, Number.NaN]],
    ['text', '[1,2,3]'],
  ])('refuses %s', (_case, json) => {
    expect(() => pgvectorVector.fromContract(json, { length: 3 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'pgvector/vector JSON value must be an array of 3 finite numbers',
      }),
    );
  });

  it("a vector codec's value carries the column's length", () => {
    const value = pgVectorDescriptor
      .factory({ length: 3 })({ name: 'embedding' })
      .toDataTypeValue([1, 2, 3]);
    expect({ params: value.params, value: value.value }).toEqual({
      params: { length: 3 },
      value: [1, 2, 3],
    });
  });
});
