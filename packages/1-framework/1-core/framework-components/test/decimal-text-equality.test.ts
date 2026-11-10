import { describe, expect, it } from 'vitest';
import { dataType } from '../src/shared/data-type';
import { decimalTextEqualityKey } from '../src/shared/decimal-text-equality';

describe('decimalTextEqualityKey', () => {
  it.each([
    ['0.5', '0.50'],
    ['1.50', '1.5'],
    ['12', '12.000'],
    ['0', '-0'],
    ['0.0', '0'],
    ['-0.10', '-0.1'],
    ['007', '7'],
    ['NaN', 'NaN'],
  ])('gives %s and %s one key', (a, b) => {
    expect(decimalTextEqualityKey(a)).toBe(decimalTextEqualityKey(b));
  });

  it.each([
    ['0.5', '0.05'],
    ['1', '-1'],
    ['10', '1'],
    ['Infinity', '-Infinity'],
  ])('gives %s and %s different keys', (a, b) => {
    expect(decimalTextEqualityKey(a)).not.toBe(decimalTextEqualityKey(b));
  });
});

describe('a data type with an equality key', () => {
  it('declares the key it was given, and a type without one declares none', () => {
    const decimal = dataType('test/decimal', {
      read: (json) => json,
      equalityKey: decimalTextEqualityKey,
    });
    const text = dataType('test/text', { read: (json) => json });
    expect({
      decimal: decimal.equalityKey?.('0.50') === decimal.equalityKey?.('0.5'),
      text: text.equalityKey,
    }).toEqual({ decimal: true, text: undefined });
  });
});
