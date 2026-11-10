import { describe, expect, it } from 'vitest';
import { asFloat, asNumeralText, castUnchanged } from '../src/shared/casts';

describe('castUnchanged', () => {
  it('returns the value it is given', () => {
    expect(castUnchanged({ a: [1] })).toEqual({ a: [1] });
  });
});

describe('asNumeralText', () => {
  it('writes a number as digit text', () => {
    expect([asNumeralText(42), asNumeralText(1e21)]).toEqual(['42', '1000000000000000000000']);
  });

  it('refuses a value that is not a number', () => {
    expect(() => asNumeralText('42')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: 'Expected a number, got "42".',
      }),
    );
  });
});

describe('asFloat', () => {
  it.each([
    ['a number', 1.5, 1.5],
    ['numeral text', '2.25', 2.25],
    ['a non-finite word', 'NaN', 'NaN'],
    ['negative infinity', '-Infinity', '-Infinity'],
  ])('takes %s', (_name, value, stored) => {
    expect(asFloat(value)).toEqual(stored);
  });

  it('refuses a value that is neither a number nor text', () => {
    expect(() => asFloat(true)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: 'Expected a number or numeral text, got true.',
      }),
    );
  });

  it('refuses a magnitude no double holds', () => {
    expect(() => asFloat('1'.padEnd(400, '0'))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: `${'1'.padEnd(400, '0')} is out of range: no double holds a number that large.`,
      }),
    );
  });
});
