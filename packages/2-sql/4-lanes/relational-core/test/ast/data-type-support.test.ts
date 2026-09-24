import { dataTypeId } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  canonicalNumeralText,
  createNumberClassifier,
  escapePslString,
  isNonFiniteText,
  isNumeralText,
  numeralText,
  parseJsonBody,
  printJsonBody,
  signedRange,
} from '../../src/ast/data-type-support';

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

describe('canonicalNumeralText', () => {
  it.each([
    ['drops leading zeros', '007', '7'],
    ['keeps trailing zeros', '-007.50', '-7.50'],
    ['drops the sign of zero', '-0', '0'],
    ['drops the sign of a zero with a fraction', '-0.00', '0.00'],
    ['leaves a plain numeral alone', '-42', '-42'],
  ])('%s', (_name, text, canonical) => {
    expect(canonicalNumeralText(text)).toBe(canonical);
  });
});

describe('numeralText', () => {
  it.each([
    ['writes a large number without an exponent', 1e21, '1000000000000000000000'],
    ['writes a small number without an exponent', 1e-7, '0.0000001'],
    ['leaves an ordinary number alone', 1.5, '1.5'],
    ['writes a negative large number without an exponent', -1e21, '-1000000000000000000000'],
    ['writes a negative small number without an exponent', -1e-7, '-0.0000001'],
    ['writes a word for a non-finite number', Number.NaN, 'NaN'],
  ])('%s', (_name, value, text) => {
    expect(numeralText(value)).toBe(text);
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

describe('isNumeralText and isNonFiniteText', () => {
  it.each(['0', '-42', '1.50'])('reads %s as a numeral', (text) => {
    expect([isNumeralText(text), isNonFiniteText(text)]).toEqual([true, false]);
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('reads %s as a non-finite word', (text) => {
    expect([isNumeralText(text), isNonFiniteText(text)]).toEqual([false, true]);
  });

  it.each(['1e3', '', 'x', '1.'])('reads %o as neither', (text) => {
    expect([isNumeralText(text), isNonFiniteText(text)]).toEqual([false, false]);
  });
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
  ])('classifies %s', (_name, text, type, value) => {
    expect(classify(text)).toEqual({ type, value });
  });

  it.each(['1e3', 'x', ''])('classifies %o as no type at all', (text) => {
    expect(classify(text)).toBeUndefined();
  });

  it('classifies a number as no type when the target holds none that wide', () => {
    const narrow = createNumberClassifier({
      integers: [{ type: small, form: 'number', ...signedRange(16) }],
      fraction: { type: real, form: 'number' },
    });
    expect([narrow('32768'), narrow('NaN'), narrow('1.5')]).toEqual([
      undefined,
      undefined,
      { type: real, value: 1.5 },
    ]);
  });
});

describe('parseJsonBody and printJsonBody', () => {
  it('reads a document and writes it back', () => {
    expect(printJsonBody(parseJsonBody('{ "plan": "free" }'))).toBe('{"plan":"free"}');
  });

  it.each(['null', '[]', '1', '"x"'])('reads %s', (text) => {
    expect(parseJsonBody(text)).toEqual(JSON.parse(text));
  });

  it('refuses a body that is not a JSON document', () => {
    expect(() => parseJsonBody('{ plan }')).toThrow();
  });

  it.each([
    ['a top-level number that overflows', '1e400', 'The value is Infinity'],
    ['a number nested in an array', '{ "a": [1, [2, -1e400]] }', 'a[1][1] is -Infinity'],
  ])('refuses %s, which JSON cannot write back', (_name, text, where) => {
    expect(() => parseJsonBody(text)).toThrow(where);
  });
});
