import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { type CanonicalDateTimeOptions, canonicalDateTime } from '../src/date-time-canonical-form';

const date: CanonicalDateTimeOptions = { shape: 'date', ownerId: 'demo/date' };
const time: CanonicalDateTimeOptions = { shape: 'time', ownerId: 'demo/time' };
const timeWithOffset: CanonicalDateTimeOptions = {
  shape: 'timeWithOffset',
  ownerId: 'demo/timetz',
  maxOffsetHours: 15,
};
const dateTime: CanonicalDateTimeOptions = { shape: 'dateTime', ownerId: 'demo/timestamp' };
const instant: CanonicalDateTimeOptions = {
  shape: 'instant',
  ownerId: 'demo/instant',
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

  it('holds at most the fraction digits a type declares', () => {
    const milliseconds: CanonicalDateTimeOptions = {
      shape: 'instant',
      ownerId: 'demo/millis',
      maxFractionDigits: 3,
    };
    expect({
      held: canonicalDateTime('2024-01-01T00:00:00.123Z', milliseconds),
      refused: refusal('2024-01-01T00:00:00.1234Z', milliseconds),
    }).toMatchObject({
      held: '2024-01-01T00:00:00.123Z',
      refused: {
        code: 'CONTRACT.CAST_REFUSED',
        message:
          '"2024-01-01T00:00:00.1234Z" has 4 digits after the decimal point, but demo/millis holds milliseconds, so at most 3. Round it, as in "2024-01-01T12:34:56.123Z".',
      },
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

  describe('leap years', () => {
    it.each([
      ['2024-02-29', '2024-02-29'],
      ['2000-02-29', '2000-02-29'],
    ])('holds %s', (text, canonical) => {
      expect(canonicalDateTime(text, date)).toBe(canonical);
    });

    it.each([
      '2023-02-29',
      '1900-02-29',
      '2024-02-30',
      '2024-04-31',
      '2024-13-01',
      '2024-00-10',
      '2024-01-00',
    ])('refuses %s, a date that does not exist', (text) => {
      expect(refusal(text, date)).toMatchObject({
        code: 'CONTRACT.CAST_REFUSED',
        message: `"${text}" is not a date that exists. Write a real date, as in "2024-01-01".`,
      });
    });
  });

  it.each([
    ['24:00:00', time],
    ['12:60:00', time],
    ['12:00:60', time],
  ])('refuses %s, a time of day that does not exist', (text, options) => {
    expect(refusal(text, options)).toMatchObject({
      code: 'CONTRACT.CAST_REFUSED',
      message: `"${text}" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "12:34:56".`,
    });
  });

  describe('UTC offsets', () => {
    it.each([
      ['12:34:56-02:30', '12:34:56-02:30'],
      ['12:34:56+02:00:30', '12:34:56+02:00:30'],
      ['12:34:56+15:59', '12:34:56+15:59'],
    ])('keeps the offset of %s', (text, canonical) => {
      expect(canonicalDateTime(text, timeWithOffset)).toBe(canonical);
    });

    it('moves an instant with an offset in seconds to UTC', () => {
      expect(canonicalDateTime('2024-01-01T00:00:00+00:00:30', instant)).toBe(
        '2023-12-31T23:59:30Z',
      );
    });

    it.each(['12:34:56+02:60', '12:34:56+02:00:60'])(
      'cannot read %s, whose offset has more than 59 minutes or seconds',
      (text) => {
        expect(refusal(text, timeWithOffset)).toMatchObject({
          message: `demo/timetz cannot read "${text}". Write a time of day with a UTC offset, as in "12:34:56+02:00".`,
        });
      },
    );

    it('refuses an offset beyond the largest the type holds', () => {
      expect(refusal('12:34:56+16:00', timeWithOffset)).toMatchObject({
        message:
          '"12:34:56+16:00" has a UTC offset outside -15:59 to +15:59, which demo/timetz does not hold. Write a smaller offset, as in "12:34:56+02:00".',
      });
    });

    it('holds offsets up to 23:59 when the type declares no limit', () => {
      expect({
        held: canonicalDateTime('2024-01-01T00:00:00-23:59', instant),
        refused: refusal('2024-01-01T00:00:00+24:00', instant),
      }).toMatchObject({
        held: '2024-01-01T23:59:00Z',
        refused: {
          message:
            '"2024-01-01T00:00:00+24:00" has a UTC offset outside -23:59 to +23:59, which demo/instant does not hold. Write a smaller offset, as in "2024-01-01T12:34:56Z".',
        },
      });
    });
  });

  describe('text that does not match the shape of the type', () => {
    it.each([
      [
        '2024-01-01T12:00:00',
        time,
        'demo/time holds a time of day without a date, but "2024-01-01T12:00:00" has a date. Write the time alone, as in "12:34:56".',
      ],
      [
        '12:34:56',
        dateTime,
        'demo/timestamp holds a date and time, but "12:34:56" has no date. Write the date too, as in "2024-01-01T12:34:56".',
      ],
      [
        '2024-01-01',
        instant,
        'demo/instant holds a date and time with a UTC offset, but "2024-01-01" has no time of day. Write the time too, as in "2024-01-01T12:34:56Z".',
      ],
      [
        '12:34:56+02:00',
        time,
        'demo/time holds no UTC offset, but "12:34:56+02:00" has one. Leave it out, as in "12:34:56".',
      ],
      [
        '2024-01-01T00:00:00',
        instant,
        'demo/instant needs a UTC offset, but "2024-01-01T00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
      ],
      [
        '12:34:56',
        timeWithOffset,
        'demo/timetz needs a UTC offset, but "12:34:56" has none. Add Z for UTC or an offset such as +02:00, as in "12:34:56+02:00".',
      ],
      [
        '2024-01-01Z',
        date,
        'demo/date holds no UTC offset, but "2024-01-01Z" has one. Leave it out, as in "2024-01-01".',
      ],
    ])('refuses %s for %s', (text, options, message) => {
      expect(refusal(text, options)).toMatchObject({ code: 'CONTRACT.CAST_REFUSED', message });
    });
  });

  describe('a range on a type without a date', () => {
    const business: CanonicalDateTimeOptions = {
      shape: 'time',
      ownerId: 'demo/business-hours',
      range: { earliest: '09:00:00', latest: '17:00:00.5' },
    };

    it.each([
      ['09:00', '09:00:00'],
      ['17:00:00.5', '17:00:00.5'],
    ])('holds %s at its bounds', (text, canonical) => {
      expect(canonicalDateTime(text, business)).toBe(canonical);
    });

    it.each(['08:59:59', '17:00:00.500001', '17:00:01'])(
      'refuses %s, outside the range',
      (text) => {
        expect(refusal(text, business)).toMatchObject({
          message: `demo/business-hours holds times of day from 09:00:00 to 17:00:00.5, and "${text}" is outside them.`,
        });
      },
    );
  });

  it('treats a range bound that is not in canonical form as a defect of the type', () => {
    expect(() =>
      canonicalDateTime('12:00:00', {
        shape: 'time',
        ownerId: 'demo/broken',
        range: { earliest: 'midnight', latest: '23:59:59' },
      }),
    ).toThrow(InternalError);
  });
});
