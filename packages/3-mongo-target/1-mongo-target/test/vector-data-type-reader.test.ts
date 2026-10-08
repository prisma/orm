import { describe, expect, it } from 'vitest';
import { mongoVector } from '../src/core/data-types';

describe('mongo/vector reads an array of as many numbers as its length', () => {
  it('reads as many numbers as its length', () => {
    expect(mongoVector.fromContract([1, 2, 3], { length: 3 }).value).toEqual([1, 2, 3]);
  });

  it('refuses a different number of numbers', () => {
    expect(() => mongoVector.fromContract([1, 2, 3, 4], { length: 3 })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'mongo/vector JSON value must be an array of 3 numbers',
        meta: { dataType: 'mongo/vector', received: '[1,2,3,4]' },
      }),
    );
  });

  it('reads any number of numbers when the column sets no length', () => {
    expect(mongoVector.fromContract([1, 2, 3, 4], {}).value).toEqual([1, 2, 3, 4]);
  });
});
