import { describe, expect, it } from 'vitest';
import { hasDigitsBelow, hasDigitsBelowAMillisecond, isValidDate, utcIsoTextOf } from '../src/date';

const EARLIEST = new Date('-004713-11-24T00:00:00Z').getTime();

describe('isValidDate', () => {
  it.each([
    [new Date('2024-01-01T00:00:00Z'), true],
    [new Date(8.64e15), true],
    [new Date(Number.NaN), false],
    ['2024-01-01T00:00:00Z', false],
    [Date.parse('2024-01-01T00:00:00Z'), false],
    [null, false],
  ])('%s is %s', (value, valid) => {
    expect(isValidDate(value)).toBe(valid);
  });
});

describe('hasDigitsBelowAMillisecond', () => {
  it.each([
    ['2024-01-01T00:00:00Z', false],
    ['2024-01-01T00:00:00.123Z', false],
    ['2024-01-01T00:00:00.123000Z', false],
    ['2024-01-01T00:00:00.1234Z', true],
    ['2024-01-01T00:00:00.000001', true],
    ['09:30:00.1', false],
  ])('%s is %s', (text, finer) => {
    expect(hasDigitsBelowAMillisecond(text)).toBe(finer);
  });
});

describe('hasDigitsBelow', () => {
  it.each([
    ['2024-01-01T00:00:00Z', 0, false],
    ['2024-01-01T00:00:00.5Z', 0, true],
    ['2024-01-01T00:00:00.000Z', 0, false],
    ['23:59:59.6', 0, true],
    ['23:59:59.120', 2, false],
    ['23:59:59.123', 2, true],
    ['2024-01-01T00:00:00.123456', 6, false],
    ['2024-01-01T00:00:00.1234567', 6, true],
  ])('%s with %i fraction digits is %s', (text, fractionDigits, finer) => {
    expect(hasDigitsBelow(text, fractionDigits)).toBe(finer);
  });
});

describe('utcIsoTextOf', () => {
  it('writes a Date as Date.toISOString writes it', () => {
    expect(utcIsoTextOf(new Date('2024-01-01T12:34:56.789+02:00'), EARLIEST)).toBe(
      '2024-01-01T10:34:56.789Z',
    );
  });

  it('writes the earliest instant it is given', () => {
    expect(utcIsoTextOf(new Date(EARLIEST), EARLIEST)).toBe('-004713-11-24T00:00:00.000Z');
  });

  it.each([
    ['an invalid Date', new Date(Number.NaN)],
    ['a Date before the earliest instant', new Date(EARLIEST - 1)],
  ])('gives no text for %s', (_description, value) => {
    expect(utcIsoTextOf(value, EARLIEST)).toBeUndefined();
  });
});
