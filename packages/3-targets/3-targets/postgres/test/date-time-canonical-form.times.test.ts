import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { pgIntervalCanonical } from '../src/core/codec-helpers';
import { pgTimeCanonical, pgTimetzCanonical } from '../src/core/data-types';

describe('pg/time canonical form', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['12:34:56', '12:34:56'],
    ['12:34', '12:34:00'],
    ['12:34:56.100', '12:34:56.1'],
    ['00:00:00', '00:00:00'],
    ['23:59:59.999999', '23:59:59.999999'],
  ];

  it.each(accepted)('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgTimeCanonical(written)).toBe(canonical);
  });

  it.each(accepted)('agrees with Temporal.PlainTime on %s', (written) => {
    expect(pgTimeCanonical(written)).toBe(Temporal.PlainTime.from(written).toString());
  });

  it.each([
    [
      '12:34:56Z',
      'pg/time holds no UTC offset, but "12:34:56Z" has one. Leave it out, as in "12:34:56".',
    ],
    [
      '12:34:56+02',
      'pg/time holds no UTC offset, but "12:34:56+02" has one. Leave it out, as in "12:34:56".',
    ],
    [
      '2024-01-01T12:34:56',
      'pg/time holds a time of day without a date, but "2024-01-01T12:34:56" has a date. Write the time alone, as in "12:34:56".',
    ],
    [
      '24:00:00',
      '"24:00:00" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "12:34:56".',
    ],
    [
      '12:60:00',
      '"12:60:00" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "12:34:56".',
    ],
    [
      '12:34:56.1234567',
      '"12:34:56.1234567" has 7 digits after the decimal point, but pg/time holds microseconds, so at most 6. Round it, as in "12:34:56.123456".',
    ],
    ['infinity', 'pg/time cannot read "infinity". Write a time of day, as in "12:34:56".'],
  ])('refuses %s', (written, message) => {
    expect(() => pgTimeCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('pg/timetz canonical form', () => {
  it.each([
    ['12:34:56+02:00', '12:34:56+02:00'],
    ['12:34:56+02', '12:34:56+02:00'],
    ['12:34:56Z', '12:34:56Z'],
    ['12:34:56+00', '12:34:56Z'],
    ['12:34:56-00:00', '12:34:56Z'],
    ['12:34:56.500+05:30', '12:34:56.5+05:30'],
    ['12:34:56+05:30:15', '12:34:56+05:30:15'],
    ['12:34-08:00', '12:34:00-08:00'],
    ['12:00:00+15:59', '12:00:00+15:59'],
  ])('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgTimetzCanonical(written)).toBe(canonical);
  });

  it.each([
    [
      '12:34:56',
      'pg/timetz needs a UTC offset, but "12:34:56" has none. Add Z for UTC or an offset such as +02:00, as in "12:34:56+02:00".',
    ],
    [
      '2024-01-01T12:34:56Z',
      'pg/timetz holds a time of day without a date, but "2024-01-01T12:34:56Z" has a date. Write the time alone, as in "12:34:56+02:00".',
    ],
    [
      '12:00:00+16:00',
      '"12:00:00+16:00" has a UTC offset outside -15:59 to +15:59, which pg/timetz does not hold. Write a smaller offset, as in "12:34:56+02:00".',
    ],
  ])('refuses %s', (written, message) => {
    expect(() => pgTimetzCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('pg/interval canonical form', () => {
  it.each([
    ['P1Y2M3DT4H5M6S', 'P1Y2M3DT4H5M6S'],
    ['P13M', 'P1Y1M'],
    ['PT0S', 'PT0S'],
    ['P0D', 'PT0S'],
    ['PT1.500S', 'PT1.5S'],
    ['P-1Y-2M3DT-4H', 'P-1Y-2M3DT-4H'],
    ['1 year 2 mons 3 days 04:05:06.5', 'P1Y2M3DT4H5M6.5S'],
    ['-1 years -2 mons +3 days -04:00:00', 'P-1Y-2M3DT-4H'],
    ['-1 days +02:00:00', 'P-1DT2H'],
    ['00:00:00', 'PT0S'],
    ['1 day', 'P1D'],
    ['-01:00:00', 'PT-1H'],
    ['25:00:00', 'PT25H'],
  ])('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgIntervalCanonical(written)).toBe(canonical);
  });

  it.each([
    [
      '1 hour',
      'pg/interval cannot read "1 hour". Write an ISO 8601 duration, as in "P1Y2M3DT4H5M6S".',
    ],
    ['', 'pg/interval cannot read "". Write an ISO 8601 duration, as in "P1Y2M3DT4H5M6S".'],
    [
      'PT1.1234567S',
      '"PT1.1234567S" has 7 digits after the decimal point, but pg/interval holds microseconds, so at most 6. Round it, as in "PT1.123456S".',
    ],
  ])('refuses %s', (written, message) => {
    expect(() => pgIntervalCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});
