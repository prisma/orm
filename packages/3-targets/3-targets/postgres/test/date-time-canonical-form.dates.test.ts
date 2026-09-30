import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
  pgDate,
  pgDateCanonical,
  pgText,
  pgTimestampCanonical,
  pgTimestamptzCanonical,
} from '../src/core/data-types';

/**
 * PostgreSQL writes a year before 1 with a ` BC` suffix and a year past 9999 with five or six
 * digits; `Temporal` reads neither, so the comparison hands it the same value as a signed year.
 */
function temporalInput(text: string): string {
  const bc = / BC$/.test(text);
  const body = bc ? text.slice(0, -3) : text;
  const match = /^(\d{4,6})(-.*)$/.exec(body);
  if (match === null) return text;
  const [, year = '', rest = ''] = match;
  if (!bc && year.length === 4) return text;
  const astronomical = bc ? 1 - Number(year) : Number(year);
  return `${astronomical < 0 ? '-' : '+'}${String(Math.abs(astronomical)).padStart(6, '0')}${rest}`;
}

describe('pg/timestamptz canonical form', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T01:00:00+01:00', '2024-01-01T00:00:00Z'],
    ['2024-01-01 00:00:00+00', '2024-01-01T00:00:00Z'],
    ['2024-01-01t00:00:00z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.123456Z', '2024-01-01T00:00:00.123456Z'],
    ['2024-01-01T00:00:00.120Z', '2024-01-01T00:00:00.12Z'],
    ['2023-12-31T23:30:00-00:30', '2024-01-01T00:00:00Z'],
    ['2024-01-01T05:30:00+05:30', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00+05:30:15', '2023-12-31T18:29:45Z'],
    ['2024-03-01T00:30:00+01:00', '2024-02-29T23:30:00Z'],
    ['2024-01-01 00:00:00.5+00', '2024-01-01T00:00:00.5Z'],
    ['1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z'],
    ['0001-01-01 00:30:00+01', '0000-12-31T23:30:00Z'],
    ['0000-06-15T00:00:00Z', '0000-06-15T00:00:00Z'],
    ['0044-03-15 00:00:00+00 BC', '-000043-03-15T00:00:00Z'],
    ['-000043-03-15T00:00:00Z', '-000043-03-15T00:00:00Z'],
    ['4713-11-24 00:00:00+00 BC', '-004712-11-24T00:00:00Z'],
    ['12026-01-02 03:04:05+00', '+012026-01-02T03:04:05Z'],
    ['+012026-01-02T03:04:05Z', '+012026-01-02T03:04:05Z'],
    ['9999-12-31T23:59:59-01:00', '+010000-01-01T00:59:59Z'],
    ['4714-11-24 00:00:00+00 BC', '-004713-11-24T00:00:00Z'],
    ['+275760-09-13T00:00:00Z', '+275760-09-13T00:00:00Z'],
  ];

  it.each(accepted)('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgTimestamptzCanonical(written)).toBe(canonical);
  });

  it.each(accepted)('agrees with Temporal.Instant on %s', (written) => {
    expect(pgTimestamptzCanonical(written)).toBe(
      Temporal.Instant.from(temporalInput(written)).toString(),
    );
  });

  it.each(['infinity', '-infinity'])('keeps %s, which PostgreSQL stores', (word) => {
    expect(pgTimestamptzCanonical(word)).toBe(word);
  });

  it.each([
    [
      '2024-01-01T00:00:00',
      'pg/timestamptz needs a UTC offset, but "2024-01-01T00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01',
      'pg/timestamptz holds a date and time with a UTC offset, but "2024-01-01" has no time of day. Write the time too, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '12:00:00Z',
      'pg/timestamptz holds a date and time with a UTC offset, but "12:00:00Z" has no date. Write the date too, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01T00:00:00.1234567Z',
      '"2024-01-01T00:00:00.1234567Z" has 7 digits after the decimal point, but pg/timestamptz holds microseconds, so at most 6. Round it, as in "2024-01-01T12:34:56.123456Z".',
    ],
    [
      '2024-02-30T00:00:00Z',
      '"2024-02-30T00:00:00Z" is not a date that exists. Write a real date, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2023-02-29T00:00:00Z',
      '"2023-02-29T00:00:00Z" is not a date that exists. Write a real date, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-13-01T00:00:00Z',
      '"2024-13-01T00:00:00Z" is not a date that exists. Write a real date, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01T25:00:00Z',
      '"2024-01-01T25:00:00Z" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01T23:59:60Z',
      '"2024-01-01T23:59:60Z" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01T00:00:00+24:00',
      '"2024-01-01T00:00:00+24:00" has a UTC offset outside -23:59 to +23:59, which pg/timestamptz does not hold. Write a smaller offset, as in "2024-01-01T12:34:56Z".',
    ],
    [
      'yesterday',
      'pg/timestamptz cannot read "yesterday". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '0000-01-01 00:00:00+00 BC',
      'pg/timestamptz cannot read "0000-01-01 00:00:00+00 BC". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '-000000-01-01T00:00:00Z',
      'pg/timestamptz cannot read "-000000-01-01T00:00:00Z". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
    ...[
      '+275760-09-13T00:00:00.000001Z',
      '+999999-01-01T00:00:00Z',
      '-271821-04-19T23:59:59Z',
      '-004713-11-23T23:59:59Z',
      '4714-11-23 23:59:59+00 BC',
    ].map((written) => [
      written,
      `pg/timestamptz holds instants from -004713-11-24T00:00:00Z to +275760-09-13T00:00:00Z, and "${written}" is outside them.`,
    ]),
  ])('refuses %s', (written, message) => {
    expect(() => pgTimestamptzCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('pg/timestamp canonical form', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01T12:34:56', '2024-01-01T12:34:56'],
    ['2024-01-01 12:34:56', '2024-01-01T12:34:56'],
    ['2024-01-01', '2024-01-01T00:00:00'],
    ['2024-01-01T12:34', '2024-01-01T12:34:00'],
    ['2024-01-01T12:34:56.500', '2024-01-01T12:34:56.5'],
    ['2024-01-01 12:34:56.123456', '2024-01-01T12:34:56.123456'],
    ['0044-03-15 00:00:00 BC', '-000043-03-15T00:00:00'],
    ['12026-01-02 03:04:05', '+012026-01-02T03:04:05'],
    ['4714-11-24 00:00:00 BC', '-004713-11-24T00:00:00'],
    ['+275760-09-13T23:59:59.999999', '+275760-09-13T23:59:59.999999'],
  ];

  it.each(accepted)('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgTimestampCanonical(written)).toBe(canonical);
  });

  it.each(accepted)('agrees with Temporal.PlainDateTime on %s', (written) => {
    expect(pgTimestampCanonical(written)).toBe(
      Temporal.PlainDateTime.from(temporalInput(written)).toString(),
    );
  });

  it.each(['infinity', '-infinity'])('keeps %s, which PostgreSQL stores', (word) => {
    expect(pgTimestampCanonical(word)).toBe(word);
  });

  it.each([
    [
      '2024-01-01T00:00:00Z',
      'pg/timestamp holds no UTC offset, but "2024-01-01T00:00:00Z" has one. Leave it out, as in "2024-01-01T12:34:56".',
    ],
    [
      '2024-01-01 00:00:00+01:00',
      'pg/timestamp holds no UTC offset, but "2024-01-01 00:00:00+01:00" has one. Leave it out, as in "2024-01-01T12:34:56".',
    ],
    [
      '12:34:56',
      'pg/timestamp holds a date and time, but "12:34:56" has no date. Write the date too, as in "2024-01-01T12:34:56".',
    ],
    [
      '2024-01-01T12:34:56.1234567',
      '"2024-01-01T12:34:56.1234567" has 7 digits after the decimal point, but pg/timestamp holds microseconds, so at most 6. Round it, as in "2024-01-01T12:34:56.123456".',
    ],
    [
      '2024-02-30T00:00:00',
      '"2024-02-30T00:00:00" is not a date that exists. Write a real date, as in "2024-01-01T12:34:56".',
    ],
    ...[
      '+275760-09-14T00:00:00',
      '-271821-04-19T00:00:00',
      '294276-12-31 23:59:59',
      '294277-01-01 00:00:00',
      '4714-11-23 23:59:59 BC',
    ].map((written) => [
      written,
      `pg/timestamp holds dates and times from -004713-11-24T00:00:00 to +275760-09-13T23:59:59.999999, and "${written}" is outside them.`,
    ]),
  ])('refuses %s', (written, message) => {
    expect(() => pgTimestampCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('pg/date canonical form', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01', '2024-01-01'],
    ['2024-02-29', '2024-02-29'],
    ['2000-02-29', '2000-02-29'],
    ['0044-03-15 BC', '-000043-03-15'],
    ['0001-01-01 BC', '0000-01-01'],
    ['-000043-03-15', '-000043-03-15'],
    ['12026-01-02', '+012026-01-02'],
    ['4714-11-24 BC', '-004713-11-24'],
    ['+275760-09-13', '+275760-09-13'],
  ];

  it.each(accepted)('turns %s into its canonical form %s', (written, canonical) => {
    expect(pgDateCanonical(written)).toBe(canonical);
  });

  it.each(accepted)('agrees with Temporal.PlainDate on %s', (written) => {
    expect(pgDateCanonical(written)).toBe(
      Temporal.PlainDate.from(temporalInput(written)).toString(),
    );
  });

  it.each(['infinity', '-infinity'])('keeps %s, which PostgreSQL stores', (word) => {
    expect(pgDateCanonical(word)).toBe(word);
  });

  it.each([
    [
      '2024-01-01T00:00:00',
      'pg/date holds a date without a time of day, but "2024-01-01T00:00:00" has a time. Write the date alone, as in "2024-01-01".',
    ],
    [
      '2024-01-01 12:00',
      'pg/date holds a date without a time of day, but "2024-01-01 12:00" has a time. Write the date alone, as in "2024-01-01".',
    ],
    [
      '2024-01-01Z',
      'pg/date holds no UTC offset, but "2024-01-01Z" has one. Leave it out, as in "2024-01-01".',
    ],
    [
      '1900-02-29',
      '"1900-02-29" is not a date that exists. Write a real date, as in "2024-01-01".',
    ],
    [
      '12:00:00',
      'pg/date holds a date, and "12:00:00" is a time of day. Write a date, as in "2024-01-01".',
    ],
    ['Jan 1 2024', 'pg/date cannot read "Jan 1 2024". Write a date, as in "2024-01-01".'],
    ...['+275761-01-01', '-271822-01-01', '+999999-01-01', '4714-11-23 BC'].map((written) => [
      written,
      `pg/date holds dates from -004713-11-24 to +275760-09-13, and "${written}" is outside them.`,
    ]),
  ])('refuses %s', (written, message) => {
    expect(() => pgDateCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('the date and time types declare their canonical form', () => {
  it('gives pg/date its canonical-form function, which its cast from text shares', () => {
    expect({
      canonical: pgDate.toCanonicalForm?.('0044-03-15 BC'),
      cast: pgDate.casts[pgText.id]?.('0044-03-15 BC'),
    }).toEqual({ canonical: '-000043-03-15', cast: '-000043-03-15' });
  });

  it('refuses a value that is not text', () => {
    expect(() => pgDate.toCanonicalForm?.(20240101)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});
