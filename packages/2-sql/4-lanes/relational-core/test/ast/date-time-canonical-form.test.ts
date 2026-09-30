import { describe, expect, it } from 'vitest';
import {
  type CanonicalDateTimeOptions,
  canonicalDateTime,
} from '../../src/ast/date-time-canonical-form';

const date: CanonicalDateTimeOptions = { shape: 'date', dataTypeId: 'demo/date' };
const time: CanonicalDateTimeOptions = { shape: 'time', dataTypeId: 'demo/time' };
const timeWithOffset: CanonicalDateTimeOptions = {
  shape: 'timeWithOffset',
  dataTypeId: 'demo/timetz',
  maxOffsetHours: 15,
};
const dateTime: CanonicalDateTimeOptions = { shape: 'dateTime', dataTypeId: 'demo/timestamp' };
const instant: CanonicalDateTimeOptions = {
  shape: 'instant',
  dataTypeId: 'demo/instant',
  range: { earliest: '-004713-11-24T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
};

function refusal(text: string, options: CanonicalDateTimeOptions, written?: string): unknown {
  try {
    canonicalDateTime(text, options, written);
  } catch (error) {
    return error;
  }
  throw new Error(`"${text}" was not refused`);
}

describe('canonicalDateTime', () => {
  it.each([
    ['2024-01-01', date, '2024-01-01'],
    ['-000043-03-15', date, '-000043-03-15'],
    ['+012026-01-02', date, '+012026-01-02'],
    ['12:34', time, '12:34:00'],
    ['12:34:56.500', time, '12:34:56.5'],
    ['12:34:56+02', timeWithOffset, '12:34:56+02:00'],
    ['12:34:56-00:00', timeWithOffset, '12:34:56Z'],
    ['2024-01-01 12:34:56', dateTime, '2024-01-01T12:34:56'],
    ['2024-01-01', dateTime, '2024-01-01T00:00:00'],
    ['2024-01-01T01:00:00+01:00', instant, '2024-01-01T00:00:00Z'],
    ['2024-01-01 00:00:00.120+00', instant, '2024-01-01T00:00:00.12Z'],
    ['0001-01-01T00:30:00+01:00', instant, '0000-12-31T23:30:00Z'],
    ['+275760-09-13T00:00:00Z', instant, '+275760-09-13T00:00:00Z'],
    ['-004713-11-24T00:00:00Z', instant, '-004713-11-24T00:00:00Z'],
  ])('turns %s into its canonical form', (text, options, canonical) => {
    expect(canonicalDateTime(text, options)).toBe(canonical);
  });

  it.each([
    ['0044-03-15 BC', date],
    ['12026-01-02', date],
    ['infinity', date],
    ['-000000-01-01', date],
    ['2024-01-01T12:34:56,5', dateTime],
  ])('reads only ISO 8601, so refuses %s', (text, options) => {
    expect(refusal(text, options)).toMatchObject({
      code: 'CONTRACT.CAST_REFUSED',
      message: expect.stringContaining(`cannot read "${text}"`),
    });
  });

  it.each([
    [
      '+275760-09-13T00:00:00.000001Z',
      'demo/instant holds instants from -004713-11-24T00:00:00Z to +275760-09-13T00:00:00Z, and "+275760-09-13T00:00:00.000001Z" is outside them.',
    ],
    [
      '-004713-11-23T23:59:59Z',
      'demo/instant holds instants from -004713-11-24T00:00:00Z to +275760-09-13T00:00:00Z, and "-004713-11-23T23:59:59Z" is outside them.',
    ],
    [
      '-004713-11-24T01:00:00+02:00',
      'demo/instant holds instants from -004713-11-24T00:00:00Z to +275760-09-13T00:00:00Z, and "-004713-11-24T01:00:00+02:00" is outside them.',
    ],
  ])('refuses %s, which is outside the range the type holds', (text, message) => {
    expect(refusal(text, instant)).toMatchObject({ code: 'CONTRACT.CAST_REFUSED', message });
  });

  it('refuses a digit below one microsecond rather than rounding it', () => {
    expect(refusal('2024-01-01T00:00:00.123456789Z', instant)).toMatchObject({
      message:
        '"2024-01-01T00:00:00.123456789Z" has 9 digits after the decimal point, but demo/instant holds microseconds, so at most 6. Round it, as in "2024-01-01T12:34:56.123456Z".',
    });
  });

  it('leads a time written for a date to a date', () => {
    expect(refusal('12:00:00', date)).toMatchObject({
      message:
        'demo/date holds a date, and "12:00:00" is a time of day. Write a date, as in "2024-01-01".',
    });
  });

  it('names the text as it was written when that differs from the text it reads', () => {
    expect(refusal('-000043-03-15T12:00:00', date, '0044-03-15 12:00:00 BC')).toMatchObject({
      message:
        'demo/date holds a date without a time of day, but "0044-03-15 12:00:00 BC" has a time. Write the date alone, as in "2024-01-01".',
    });
  });
});
