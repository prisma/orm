import { describe, expect, it } from 'vitest';
import { booleanFromInteger, integerFromBoolean } from '../src/boolean';

describe('booleanFromInteger', () => {
  it.each([
    [0, false],
    [1, true],
    [-0, false],
    [0n, false],
    [1n, true],
    ['0', false],
    ['1', true],
  ])('reads %o as %s', (stored, value) => {
    expect(booleanFromInteger(stored)).toBe(value);
  });

  it.each([
    2,
    -1,
    0.5,
    Number.NaN,
    2n,
    -1n,
    '2',
    '00',
    '01',
    ' 1',
    '1.0',
    'true',
    'yes',
    '',
    true,
    false,
    null,
    undefined,
  ])('reads no boolean from %o', (stored) => {
    expect(booleanFromInteger(stored)).toBeUndefined();
  });
});

describe('integerFromBoolean', () => {
  it('stores true as 1 and false as 0', () => {
    expect({ true: integerFromBoolean(true), false: integerFromBoolean(false) }).toEqual({
      true: 1,
      false: 0,
    });
  });
});
