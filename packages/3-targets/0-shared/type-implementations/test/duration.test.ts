import { describe, expect, it } from 'vitest';
import { ISO_DURATION, ISO_DURATION_AS_WRITTEN } from '../src/duration';

describe('ISO_DURATION', () => {
  it.each([
    'P1Y2M3DT4H5M6S',
    'P1Y',
    'P3D',
    'PT1H30M',
    'PT0S',
    'PT1.5S',
    'P-1Y-2M',
    'PT-4H-5M-6.25S',
  ])('matches %s', (text) => {
    expect(ISO_DURATION.test(text)).toBe(true);
  });

  it.each(['P', 'PT', 'P1DT', '1Y', 'P1W', 'PT1.S', 'P1.5Y', 'p1y', 'P1Y ', ''])(
    'does not match %j',
    (text) => {
      expect(ISO_DURATION.test(text)).toBe(false);
    },
  );

  it('captures each component', () => {
    expect(ISO_DURATION.exec('P1Y2M3DT4H5M6.5S')?.slice(1)).toEqual([
      '1Y',
      '2M',
      '3D',
      '4H',
      '5M',
      '6.5S',
    ]);
  });
});

describe('ISO_DURATION_AS_WRITTEN', () => {
  it.each([
    { days: -1 },
    { weeks: 1 },
    { weeks: -2, days: -3 },
    { years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7, milliseconds: 8 },
    { hours: 1, minutes: 30 },
    { seconds: 1, milliseconds: 500 },
    { microseconds: 1 },
    { seconds: 0 },
  ])('matches what Temporal.Duration writes for %o', (fields) => {
    expect(ISO_DURATION_AS_WRITTEN.test(Temporal.Duration.from(fields).toString())).toBe(true);
  });

  it.each(['P1Y2M3DT4H5M6S', 'PT1.5S', 'P-1Y-2M', 'PT-4H-5M-6.25S', '+P1D', '-P1W', 'P1W2D'])(
    'matches %s, as ISO_DURATION does or with a leading sign or weeks',
    (text) => {
      expect(ISO_DURATION_AS_WRITTEN.test(text)).toBe(true);
    },
  );

  it.each(['P', 'PT', '-P', 'P1DT', '1Y', 'PT1.S', 'P1.5Y', 'p1y', 'P1Y ', '', '-P-1D', '+-P1D'])(
    'does not match %j',
    (text) => {
      expect(ISO_DURATION_AS_WRITTEN.test(text)).toBe(false);
    },
  );
});
