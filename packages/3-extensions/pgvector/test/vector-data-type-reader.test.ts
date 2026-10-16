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

  it.each([
    [[0.5, 0.1, -1e3], 'numbers real holds as written'],
    [[3.4e38, 0.25, 1e-10], 'a large, an exact and a small number real holds'],
  ])('reads %j, %s', (json) => {
    expect(pgvectorVector.fromContract(json, { length: 3 }).value).toEqual(json);
  });

  it.each([
    [[0.123456789, 1, 2], '1', '0.123456789', '0.12345679'],
    [[1, 1e-50, 2], '2', '1e-50', '0'],
    [[1, 2, 16777217], '3', '16777217', '16777216'],
  ])(
    'refuses %j, naming element %s, %s, and what PostgreSQL would store, %s',
    (json, element, written, stored) => {
      expect(() => pgvectorVector.fromContract(json, { length: 3 })).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DECODE_FAILED',
          message: `pgvector/vector JSON value must be an array of numbers real holds exactly; element ${element}, ${written}, would be stored as ${stored}`,
        }),
      );
    },
  );

  it.each([3.5e38, -1e39])('refuses %d, which is outside the range real holds', (outside) => {
    expect(() => pgvectorVector.fromContract([1, outside, 2], { length: 3 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: `pgvector/vector JSON value must be an array of numbers real holds exactly; element 2, ${outside}, is outside the range real holds, which PostgreSQL refuses`,
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
