import { describe, expect, it } from 'vitest';
import { isArrayEqual } from '../src/array-equal';

describe('isArrayEqual', () => {
  it('returns true for equal arrays', () => {
    expect(isArrayEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isArrayEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isArrayEqual([], [])).toBe(true);
  });

  it('returns false for arrays of different lengths', () => {
    expect(isArrayEqual(['a'], ['a', 'b'])).toBe(false);
    expect(isArrayEqual(['a', 'b'], ['a'])).toBe(false);
    expect(isArrayEqual([], ['a'])).toBe(false);
  });

  it('returns false for arrays with different elements', () => {
    expect(isArrayEqual(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(isArrayEqual([1, 2], [1, 3])).toBe(false);
  });

  it('uses Object.is for element comparison', () => {
    expect(isArrayEqual([0], [-0])).toBe(false);
    expect(isArrayEqual([Number.NaN], [Number.NaN])).toBe(true);
    expect(isArrayEqual([+0], [+0])).toBe(true);
  });
});
