import { describe, expect, it } from 'vitest';
import { ISO_DURATION } from '../src/duration';

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
