import { describe, expect, it } from 'vitest';
import {
  decimalTextWithoutExponent,
  decimalTextWithoutLeadingZeros,
  decimalTextWithoutSignOfZero,
  isDecimalText,
  printedDecimalText,
} from '../src/decimal';

describe('isDecimalText', () => {
  it.each(['0', '-0', '12', '-12.50', '007', '0.000000000000000001', '12345678901234567890.1'])(
    'holds for %j',
    (text) => {
      expect(isDecimalText(text)).toBe(true);
    },
  );

  it.each([
    '',
    '-',
    '+1',
    '.5',
    '1.',
    '1e5',
    '1E+3',
    '1_000',
    ' 1',
    '1 ',
    'NaN',
    'Infinity',
    '0x1f',
  ])('does not hold for %j', (text) => {
    expect(isDecimalText(text)).toBe(false);
  });
});

describe('decimal text normalisation', () => {
  it.each([
    ['007', '7', '007', '7'],
    ['00.10', '0.10', '00.10', '0.10'],
    ['-007.50', '-7.50', '-007.50', '-7.50'],
    ['-0', '-0', '0', '0'],
    ['-00.000', '-0.000', '00.000', '0.000'],
    ['12.50', '12.50', '12.50', '12.50'],
    ['NaN', 'NaN', 'NaN', 'NaN'],
  ])(
    '%j without leading zeros is %j, without the sign of zero %j, and printed %j',
    (text, withoutLeadingZeros, withoutSignOfZero, printed) => {
      expect({
        withoutLeadingZeros: decimalTextWithoutLeadingZeros(text),
        withoutSignOfZero: decimalTextWithoutSignOfZero(text),
        printed: printedDecimalText(text),
      }).toEqual({ withoutLeadingZeros, withoutSignOfZero, printed });
    },
  );
});

describe('decimalTextWithoutExponent', () => {
  it.each([
    ['1E+3', '1000'],
    ['1.23E+40', '12300000000000000000000000000000000000000'],
    ['1.5E-3', '0.0015'],
    ['-1.5E-3', '-0.0015'],
    ['12.50', '12.50'],
    ['-0', '0'],
    ['-0E+3', '0'],
    ['0E-2', '0.00'],
    ['00012', '12'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['-Infinity', '-Infinity'],
  ])('writes %j as %j', (text, written) => {
    expect(decimalTextWithoutExponent(text)).toBe(written);
  });

  it.each(['', 'abc', '1e3', '.5', '+1'])('reads no decimal from %j', (text) => {
    expect(decimalTextWithoutExponent(text)).toBeUndefined();
  });
});
