import { dataTypeId } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  createNumberClassifier,
  escapePslString,
  isNumeralText,
  parseJsonText,
  printJsonText,
  signedRange,
  storedNumeralText,
} from '../src/data-type-support';

const small = dataTypeId('demo/small');
const large = dataTypeId('demo/large');
const wide = dataTypeId('demo/wide');
const real = dataTypeId('demo/real');

describe('signedRange', () => {
  it.each([
    [8, -128n, 127n],
    [16, -32768n, 32767n],
    [32, -2147483648n, 2147483647n],
    [64, -9223372036854775808n, 9223372036854775807n],
  ])('gives the bounds of a signed %i-bit integer', (bits, min, max) => {
    expect(signedRange(bits)).toEqual({ min, max });
  });
});

describe('storedNumeralText', () => {
  it.each([
    ['drops leading zeros', '007', '7'],
    ['keeps trailing zeros', '-007.50', '-7.50'],
    ['drops the sign of zero', '-0', '0'],
    ['drops the sign of a zero with a fraction', '-0.00', '0.00'],
    ['leaves a plain numeral alone', '-42', '-42'],
    ['drops a plus sign', '+42', '42'],
    ['drops a plus sign and leading zeros and keeps trailing zeros', '+007.50', '7.50'],
    ['drops the plus sign of zero', '+0.0', '0.0'],
  ])('%s', (_name, text, canonical) => {
    expect(storedNumeralText(text)).toBe(canonical);
  });
});

describe('escapePslString', () => {
  it.each([
    ['leaves ordinary text alone', 'free', 'free'],
    ['doubles a backslash', 'a\\b', 'a\\\\b'],
    ['escapes a double quote', 'say "hi"', 'say \\"hi\\"'],
    ['escapes a newline', 'one\ntwo', 'one\\ntwo'],
    ['escapes a carriage return', 'one\rtwo', 'one\\rtwo'],
  ])('%s', (_name, value, escaped) => {
    expect(escapePslString(value)).toBe(escaped);
  });
});

describe('isNumeralText', () => {
  it.each(['0', '-42', '1.50', '+42', '+1.50'])('reads %s as a numeral', (text) => {
    expect(isNumeralText(text)).toBe(true);
  });

  it.each(['NaN', 'Infinity', '-Infinity', '1e3', '', 'x', '1.', '+', '+-1', '++1', '+ 1'])(
    'reads %o as no numeral',
    (text) => {
      expect(isNumeralText(text)).toBe(false);
    },
  );
});

describe('createNumberClassifier', () => {
  const classify = createNumberClassifier({
    integers: [
      { type: small, form: 'number', ...signedRange(16) },
      { type: large, form: 'text', ...signedRange(64) },
    ],
    largerWhole: { type: wide, form: 'text' },
    fraction: { type: wide, form: 'text' },
    words: { type: wide, form: 'text' },
  });

  it.each([
    ['the low bound of the first step', '-32768', small, -32768],
    ['the high bound of the first step', '32767', small, 32767],
    ['one below the first step', '-32769', large, '-32769'],
    ['one above the first step', '32768', large, '32768'],
    ['the high bound of the second step', '9223372036854775807', large, '9223372036854775807'],
    ['one above the second step', '9223372036854775808', wide, '9223372036854775808'],
    ['a number with a fraction', '1.50', wide, '1.50'],
    ['a non-finite word', 'NaN', wide, 'NaN'],
    ['leading zeros', '007', small, 7],
    ['a negative zero', '-0', small, 0],
    ['a whole number with a plus sign', '+1', small, 1],
    ['a plus sign and leading zeros', '+007', small, 7],
    ['a zero with a plus sign', '+0', small, 0],
    ['a whole number with a plus sign past the first step', '+32768', large, '32768'],
    [
      'a whole number with a plus sign past the second step',
      '+9223372036854775808',
      wide,
      '9223372036854775808',
    ],
    ['a number with a fraction and a plus sign', '+1.50', wide, '1.50'],
  ])('classifies %s', (_name, text, type, value) => {
    expect(classify(text)).toEqual({ type, value });
  });

  it.each(['1e3', 'x', '', '+', '+x', '++1', '+-1', '+NaN'])(
    'classifies %o as no type at all',
    (text) => {
      expect(classify(text)).toBeUndefined();
    },
  );

  it('classifies a number as no type when the target holds none that wide', () => {
    const narrow = createNumberClassifier({
      integers: [{ type: small, form: 'number', ...signedRange(16) }],
      fraction: { type: real, form: 'number' },
    });
    expect([narrow('32768'), narrow('NaN'), narrow('1.5'), narrow('+1.5')]).toEqual([
      undefined,
      undefined,
      { type: real, value: 1.5 },
      { type: real, value: 1.5 },
    ]);
  });
});

describe('parseJsonText and printJsonText', () => {
  it('reads a document and writes it back', () => {
    expect(printJsonText(parseJsonText('{ "plan": "free" }'))).toBe('{"plan":"free"}');
  });

  it.each(['null', '[]', '1', '"x"'])('reads %s', (text) => {
    expect(parseJsonText(text)).toEqual(JSON.parse(text));
  });

  it('refuses a body that is not a JSON document', () => {
    expect(() => parseJsonText('{ plan }')).toThrow();
  });

  it.each([
    ['a top-level number that overflows', '1e400', 'The value is Infinity'],
    ['a number nested in an array', '{ "a": [1, [2, -1e400]] }', 'a[1][1] is -Infinity'],
  ])('refuses %s, which JSON cannot write back', (_name, text, where) => {
    expect(() => parseJsonText(text)).toThrow(where);
  });
});
