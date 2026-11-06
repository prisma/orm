import { describe, expect, it } from 'vitest';
import { hasDigitsBelowAMillisecond, isValidDate, utcIsoTextOf } from '../src/date';

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
