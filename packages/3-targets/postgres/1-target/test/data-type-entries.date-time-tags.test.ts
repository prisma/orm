import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresDataTypeEntries } from '../src/core/data-type-entries';

const entries = postgresDataTypeEntries();

function tagEntry(key: string): {
  readonly tag: string;
  readonly parse: (text: string) => unknown;
  readonly print: DataTypeAuthoringEntry['print'];
} {
  const entry = entries[key];
  if (entry === undefined || entry.written.kind !== 'tag') throw new Error(`no tag under ${key}`);
  return { tag: entry.written.tag, parse: entry.written.parse, print: entry.print };
}

const refusal = (message: string) =>
  expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message });

describe('the date, time and bytes tags', () => {
  it('registers one tag under each type, named after it', () => {
    expect(
      [
        'pg/date',
        'pg/time',
        'pg/timetz',
        'pg/timestamp',
        'pg/timestamptz',
        'pg/interval',
        'pg/bytea',
      ].map((key) => tagEntry(key).tag),
    ).toEqual(['date', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval', 'bytea']);
  });

  it.each([
    ['pg/date', '2024-01-01', '2024-01-01'],
    ['pg/date', '0044-03-15 BC', '-000043-03-15'],
    ['pg/date', '12026-01-02', '+012026-01-02'],
    ['pg/date', '+012026-01-02', '+012026-01-02'],
    ['pg/date', 'infinity', 'infinity'],
    ['pg/date', '-infinity', '-infinity'],
    ['pg/time', '12:34', '12:34:00'],
    ['pg/time', '12:34:56.500', '12:34:56.5'],
    ['pg/timetz', '12:34:56+02', '12:34:56+02:00'],
    ['pg/timetz', '12:34:56+00:00', '12:34:56Z'],
    ['pg/timestamp', '2024-01-01 12:34:56', '2024-01-01T12:34:56'],
    ['pg/timestamp', '2024-01-01T12:34:56.500', '2024-01-01T12:34:56.5'],
    ['pg/timestamp', 'infinity', 'infinity'],
    ['pg/timestamptz', '2024-01-01T01:00:00+01:00', '2024-01-01T00:00:00Z'],
    ['pg/timestamptz', '2024-01-01 00:00:00.000Z', '2024-01-01T00:00:00Z'],
    ['pg/timestamptz', '0044-03-15 12:00:00+00 BC', '-000043-03-15T12:00:00Z'],
    ['pg/timestamptz', '-infinity', '-infinity'],
    ['pg/interval', 'P14MT90M', 'P1Y2MT1H30M'],
    ['pg/interval', '1 year 2 mons', 'P1Y2M'],
    ['pg/interval', '-1 days -04:05:00', 'P-1DT-4H-5M'],
    ['pg/bytea', '\\x68656c6c6f', 'aGVsbG8='],
    ['pg/bytea', '\\x', ''],
  ])('reads %s text %s as the stored value %s', (key, text, stored) => {
    expect(tagEntry(key).parse(text)).toBe(stored);
  });

  it.each([
    ['pg/date', '2024-01-01'],
    ['pg/date', '-000043-03-15'],
    ['pg/date', 'infinity'],
    ['pg/time', '12:34:56.5'],
    ['pg/timetz', '12:34:56Z'],
    ['pg/timestamp', '+012026-01-02T00:00:00'],
    ['pg/timestamptz', '-004713-11-24T00:00:00Z'],
    ['pg/interval', 'P-1DT-4H-5M'],
    ['pg/bytea', 'aGVsbG8='],
  ])('prints the %s value %s as text the tag reads back', (key, stored) => {
    const { parse, print } = tagEntry(key);
    expect(parse(print(stored))).toBe(stored);
  });

  it('prints bytes as the hex text PostgreSQL prints', () => {
    expect(tagEntry('pg/bytea').print('aGVsbG8=')).toBe('\\x68656c6c6f');
  });

  it.each([
    [
      'pg/date',
      '2024-01-01T00:00:00',
      'pg/date holds a date without a time of day, but "2024-01-01T00:00:00" has a time. Write the date alone, as in "2024-01-01".',
    ],
    [
      'pg/date',
      '2024-02-30',
      '"2024-02-30" is not a date that exists. Write a real date, as in "2024-01-01".',
    ],
    [
      'pg/date',
      '-004713-11-23',
      'pg/date holds dates from -004713-11-24 to +275760-09-13, and "-004713-11-23" is outside them.',
    ],
    [
      'pg/date',
      '12:00:00',
      'pg/date holds a date, and "12:00:00" is a time of day. Write a date, as in "2024-01-01".',
    ],
    [
      'pg/time',
      '12:34:56+02',
      'pg/time holds no UTC offset, but "12:34:56+02" has one. Leave it out, as in "12:34:56".',
    ],
    [
      'pg/time',
      '12:34:56.1234567',
      '"12:34:56.1234567" has 7 digits after the decimal point, but pg/time holds microseconds, so at most 6. Round it, as in "12:34:56.123456".',
    ],
    ['pg/time', 'infinity', expect.stringContaining('"infinity"')],
    [
      'pg/timetz',
      '12:34:56',
      'pg/timetz needs a UTC offset, but "12:34:56" has none. Add Z for UTC or an offset such as +02:00, as in "12:34:56+02:00".',
    ],
    [
      'pg/timestamptz',
      '2024-01-01 12:00:00',
      'pg/timestamptz needs a UTC offset, but "2024-01-01 12:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
    ],
    [
      'pg/timestamptz',
      '+275760-09-14T00:00:00Z',
      'pg/timestamptz holds instants from -004713-11-24T00:00:00Z to +275760-09-13T00:00:00Z, and "+275760-09-14T00:00:00Z" is outside them.',
    ],
    [
      'pg/interval',
      'nope',
      'pg/interval cannot read "nope". Write an ISO 8601 duration, as in "P1Y2M3DT4H5M6S".',
    ],
    [
      'pg/bytea',
      'aGVsbG8=',
      '"aGVsbG8=" is not the hex text PostgreSQL prints for bytea, which is \\x followed by two hexadecimal digits for each byte, as in \\x68656c6c6f.',
    ],
    [
      'pg/bytea',
      '\\x6',
      '"\\x6" is not the hex text PostgreSQL prints for bytea, which is \\x followed by two hexadecimal digits for each byte, as in \\x68656c6c6f.',
    ],
  ])('refuses %s text %s, saying why', (key, text, message) => {
    expect(() => tagEntry(key).parse(text)).toThrow(refusal(message));
  });

  it('reads a date without Temporal or Date', () => {
    const temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
    const date = Object.getOwnPropertyDescriptor(globalThis, 'Date');
    Reflect.deleteProperty(globalThis, 'Temporal');
    Reflect.deleteProperty(globalThis, 'Date');
    try {
      expect([
        tagEntry('pg/timestamptz').parse('2024-01-01T01:00:00+01:00'),
        tagEntry('pg/date').parse('0044-03-15 BC'),
        tagEntry('pg/interval').parse('1 year'),
      ]).toEqual(['2024-01-01T00:00:00Z', '-000043-03-15', 'P1Y']);
    } finally {
      if (temporal !== undefined) Object.defineProperty(globalThis, 'Temporal', temporal);
      if (date !== undefined) Object.defineProperty(globalThis, 'Date', date);
    }
  });
});
