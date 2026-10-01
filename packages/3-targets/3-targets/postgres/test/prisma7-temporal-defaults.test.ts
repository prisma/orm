import { describe, expect, it } from 'vitest';
import { storedTemporalText } from '../src/core/prisma7-temporal-defaults';

/**
 * Each row is a `@default("...")` Prisma 7 accepts for a `DateTime` field, and
 * the text inside the column default Postgres reports for each native type
 * after applying the SQL `prisma@7.10.0 migrate diff` generated, read with
 * `pg_get_expr` in a UTC session. Precision modifiers do not change the stored
 * default.
 */
const storedByPostgres: readonly (readonly [
  string,
  Readonly<Record<'timestamp' | 'timestamptz' | 'date' | 'time' | 'timetz', string>>,
])[] = [
  [
    '2024-01-02T03:04:05.000Z',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 03:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+00',
    },
  ],
  [
    '2024-01-02T03:04:05.123Z',
    {
      timestamp: '2024-01-02 03:04:05.123',
      timestamptz: '2024-01-02 03:04:05.123+00',
      date: '2024-01-02',
      time: '03:04:05.123',
      timetz: '03:04:05.123+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1235Z',
    {
      timestamp: '2024-01-02 03:04:05.1235',
      timestamptz: '2024-01-02 03:04:05.1235+00',
      date: '2024-01-02',
      time: '03:04:05.1235',
      timetz: '03:04:05.1235+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234995Z',
    {
      timestamp: '2024-01-02 03:04:05.1235',
      timestamptz: '2024-01-02 03:04:05.1235+00',
      date: '2024-01-02',
      time: '03:04:05.1235',
      timetz: '03:04:05.1235+00',
    },
  ],
  [
    '2024-01-02T03:04:05+02:00',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 01:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+02',
    },
  ],
  [
    '2024-01-02T23:04:05-05:00',
    {
      timestamp: '2024-01-02 23:04:05',
      timestamptz: '2024-01-03 04:04:05+00',
      date: '2024-01-02',
      time: '23:04:05',
      timetz: '23:04:05-05',
    },
  ],
  [
    '2024-01-02T03:04:05+05:30',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-01 21:34:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+05:30',
    },
  ],
  [
    '2024-01-02T03:04:05-00:00',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 03:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+00',
    },
  ],
  [
    '2024-01-02t03:04:05z',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 03:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+00',
    },
  ],
  [
    '2024-01-02 03:04:05Z',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 03:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234567891Z',
    {
      timestamp: '2024-01-02 03:04:05.123457',
      timestamptz: '2024-01-02 03:04:05.123457+00',
      date: '2024-01-02',
      time: '03:04:05.123457',
      timetz: '03:04:05.123457+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234565Z',
    {
      timestamp: '2024-01-02 03:04:05.123456',
      timestamptz: '2024-01-02 03:04:05.123456+00',
      date: '2024-01-02',
      time: '03:04:05.123456',
      timetz: '03:04:05.123456+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234575Z',
    {
      timestamp: '2024-01-02 03:04:05.123458',
      timestamptz: '2024-01-02 03:04:05.123458+00',
      date: '2024-01-02',
      time: '03:04:05.123458',
      timetz: '03:04:05.123458+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234565001Z',
    {
      timestamp: '2024-01-02 03:04:05.123457',
      timestamptz: '2024-01-02 03:04:05.123457+00',
      date: '2024-01-02',
      time: '03:04:05.123457',
      timetz: '03:04:05.123457+00',
    },
  ],
  [
    '2024-01-02T03:04:05.12345650000001Z',
    {
      timestamp: '2024-01-02 03:04:05.123457',
      timestamptz: '2024-01-02 03:04:05.123457+00',
      date: '2024-01-02',
      time: '03:04:05.123457',
      timetz: '03:04:05.123457+00',
    },
  ],
  [
    '2024-01-02T03:04:05.1234564999Z',
    {
      timestamp: '2024-01-02 03:04:05.123456',
      timestamptz: '2024-01-02 03:04:05.123456+00',
      date: '2024-01-02',
      time: '03:04:05.123456',
      timetz: '03:04:05.123456+00',
    },
  ],
  [
    '2024-01-02T03:04:05.0000005Z',
    {
      timestamp: '2024-01-02 03:04:05',
      timestamptz: '2024-01-02 03:04:05+00',
      date: '2024-01-02',
      time: '03:04:05',
      timetz: '03:04:05+00',
    },
  ],
  [
    '2024-01-02T03:04:05.0000015Z',
    {
      timestamp: '2024-01-02 03:04:05.000002',
      timestamptz: '2024-01-02 03:04:05.000002+00',
      date: '2024-01-02',
      time: '03:04:05.000002',
      timetz: '03:04:05.000002+00',
    },
  ],
  [
    '2024-12-31T23:59:59.9999995Z',
    {
      timestamp: '2025-01-01 00:00:00',
      timestamptz: '2025-01-01 00:00:00+00',
      date: '2024-12-31',
      time: '24:00:00',
      timetz: '24:00:00+00',
    },
  ],
  [
    '2024-12-31T23:59:59.5Z',
    {
      timestamp: '2024-12-31 23:59:59.5',
      timestamptz: '2024-12-31 23:59:59.5+00',
      date: '2024-12-31',
      time: '23:59:59.5',
      timetz: '23:59:59.5+00',
    },
  ],
  [
    '2024-12-31T23:59:60Z',
    {
      timestamp: '2025-01-01 00:00:00',
      timestamptz: '2025-01-01 00:00:00+00',
      date: '2024-12-31',
      time: '24:00:00',
      timetz: '24:00:00+00',
    },
  ],
  [
    '1999-12-31T23:59:58.5Z',
    {
      timestamp: '1999-12-31 23:59:58.5',
      timestamptz: '1999-12-31 23:59:58.5+00',
      date: '1999-12-31',
      time: '23:59:58.5',
      timetz: '23:59:58.5+00',
    },
  ],
  [
    '1999-12-31T23:59:59.5Z',
    {
      timestamp: '1999-12-31 23:59:59.5',
      timestamptz: '1999-12-31 23:59:59.5+00',
      date: '1999-12-31',
      time: '23:59:59.5',
      timetz: '23:59:59.5+00',
    },
  ],
  [
    '1970-01-01T12:34:56.100Z',
    {
      timestamp: '1970-01-01 12:34:56.1',
      timestamptz: '1970-01-01 12:34:56.1+00',
      date: '1970-01-01',
      time: '12:34:56.1',
      timetz: '12:34:56.1+00',
    },
  ],
  [
    '0999-06-15T10:20:30.25Z',
    {
      timestamp: '0999-06-15 10:20:30.25',
      timestamptz: '0999-06-15 10:20:30.25+00',
      date: '0999-06-15',
      time: '10:20:30.25',
      timetz: '10:20:30.25+00',
    },
  ],
  [
    '0001-01-01T00:30:00+01:00',
    {
      timestamp: '0001-01-01 00:30:00',
      timestamptz: '0001-12-31 23:30:00+00 BC',
      date: '0001-01-01',
      time: '00:30:00',
      timetz: '00:30:00+01',
    },
  ],
  [
    '0001-01-01T00:00:00.5+00:01',
    {
      timestamp: '0001-01-01 00:00:00.5',
      timestamptz: '0001-12-31 23:59:00.5+00 BC',
      date: '0001-01-01',
      time: '00:00:00.5',
      timetz: '00:00:00.5+00:01',
    },
  ],
];

describe('storedTemporalText', () => {
  it.each(storedByPostgres)('gives the default Postgres stores for %s', (written, stored) => {
    expect({
      timestamp: storedTemporalText(written, 'timestamp'),
      timestamptz: storedTemporalText(written, 'timestamptz'),
      date: storedTemporalText(written, 'date'),
      time: storedTemporalText(written, 'time'),
      timetz: storedTemporalText(written, 'timetz'),
    }).toEqual(stored);
  });

  it('reads nothing from text that is not an RFC 3339 date and time', () => {
    expect(
      [
        '2024-01-02',
        '2024-01-02T03:04:05',
        '2024-01-02T03:04Z',
        '2024-01-02T03:04:05+0200',
        '+002024-01-02T03:04:05Z',
      ].map((text) => storedTemporalText(text, 'timestamp')),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
