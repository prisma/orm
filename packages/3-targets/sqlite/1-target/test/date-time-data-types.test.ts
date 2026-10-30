import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { sqliteDataTypeEntries } from '../src/core/data-type-entries';
import {
  sqliteDate,
  sqliteDateText,
  sqliteDatetimeTextAtMilliseconds,
  sqliteDuration,
  sqliteDurationText,
  sqliteTime,
  sqliteTimeText,
} from '../src/core/data-types';

const entries = sqliteDataTypeEntries();

function parseTag(dataTypeId: string, body: string) {
  const entry: DataTypeAuthoringEntry | undefined = entries[dataTypeId];
  if (entry?.written.kind !== 'tag') throw new Error(`${dataTypeId} has no tag entry`);
  return entry.written.parse(body);
}

const CAST_REFUSED = expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' });

describe('sqlite/date', () => {
  it.each([
    ['2024-02-29', '2024-02-29'],
    ['0000-01-01', '0000-01-01'],
    ['9999-12-31', '9999-12-31'],
  ])('stores %s as %s', (text, stored) => {
    expect(sqliteDateText(text)).toBe(stored);
  });

  it.each([
    ['a date that does not exist', '2023-02-29'],
    ['a time of day', '2024-02-29T00:00:00'],
    ['a year past 9999, which SQLite’s date() does not read', '+010000-01-01'],
    ['a year before 0000', '-000001-01-01'],
    ['text that is no date', 'tomorrow'],
  ])('refuses %s', (_name, text) => {
    expect(() => sqliteDateText(text)).toThrow(CAST_REFUSED);
  });

  it('reads only its stored form from a contract', () => {
    expect(sqliteDate.toContract(sqliteDate.fromContract('2024-02-29', {}))).toBe('2024-02-29');
    expect(() => sqliteDate.fromContract('2024-02-30', {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });

  it('has a date tag that reads a date and refuses text the type does not take', () => {
    expect(parseTag(sqliteDate.id, '2024-02-29')).toBe('2024-02-29');
    expect(() => parseTag(sqliteDate.id, '2024-02-29T09:30:00')).toThrow(
      expect.objectContaining({
        message:
          'sqlite/date holds a date without a time of day, but "2024-02-29T09:30:00" has a time. Write the date alone, as in "2024-01-01".',
      }),
    );
  });
});

describe('sqlite/time', () => {
  it.each([
    ['09:30', '09:30:00.000'],
    ['09:30:00', '09:30:00.000'],
    ['09:30:00.5', '09:30:00.500'],
    ['09:30:00.123', '09:30:00.123'],
    ['09:30:00.500000', '09:30:00.500'],
    ['23:59:59.999', '23:59:59.999'],
  ])('stores %s with three fraction digits, as %s', (text, stored) => {
    expect(sqliteTimeText(text)).toBe(stored);
  });

  it.each([
    ['digits below a millisecond', '09:30:00.1234'],
    ['an offset', '09:30:00+02:00'],
    ['a date', '2024-01-01T09:30:00'],
    ['an hour past 23', '24:00:00'],
  ])('refuses %s', (_name, text) => {
    expect(() => sqliteTimeText(text)).toThrow(CAST_REFUSED);
  });

  it('names the text it was given when it refuses digits below a millisecond', () => {
    expect(() => sqliteTimeText('09:30:00.1234')).toThrow(
      expect.objectContaining({
        message:
          '"09:30:00.1234" has 4 digits after the decimal point, but sqlite/time holds milliseconds, so at most 3. Round it, as in "12:34:56.123".',
      }),
    );
  });

  it('reads only its stored form from a contract', () => {
    expect(sqliteTime.toContract(sqliteTime.fromContract('09:30:00.000', {}))).toBe('09:30:00.000');
    expect(() => sqliteTime.fromContract('09:30:00', {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });

  it('has a time tag that writes its stored form and refuses text the type does not take', () => {
    expect(parseTag(sqliteTime.id, '09:30')).toBe('09:30:00.000');
    expect(() => parseTag(sqliteTime.id, '09:30:00Z')).toThrow(CAST_REFUSED);
  });
});

describe('sqlite/duration', () => {
  it.each(['PT1H30M', 'P1Y2M3DT4H5M6.5S', 'P1D', 'PT24H', 'P-1M'])(
    'stores %s as written',
    (text) => {
      expect(sqliteDurationText(text)).toBe(text);
    },
  );

  it.each([
    ['an empty duration', 'P'],
    ['weeks, which the pattern does not read', 'P2W'],
    ['PostgreSQL’s interval text', '1 hour'],
  ])('refuses %s', (_name, text) => {
    expect(() => sqliteDurationText(text)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: `sqlite/duration cannot read "${text}". Write an ISO 8601 duration, as in "PT1H30M".`,
      }),
    );
  });

  it('keeps two spellings of one length of time apart', () => {
    expect(
      ['P1D', 'PT24H'].map((text) =>
        sqliteDuration.toContract(sqliteDuration.fromContract(text, {})),
      ),
    ).toEqual(['P1D', 'PT24H']);
  });

  it('has a duration tag that refuses text that is no duration', () => {
    expect(parseTag(sqliteDuration.id, 'PT1H30M')).toBe('PT1H30M');
    expect(() => parseTag(sqliteDuration.id, '90 minutes')).toThrow(CAST_REFUSED);
  });
});

describe('an instant written at the millisecond', () => {
  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T01:00:00.5+01:00', '2024-01-01T00:00:00.500Z'],
    ['2024-01-01T00:00:00.123000Z', '2024-01-01T00:00:00.123Z'],
  ])('stores %s as %s', (text, stored) => {
    expect(sqliteDatetimeTextAtMilliseconds(text)).toBe(stored);
  });

  it('refuses digits below a millisecond rather than rounding them', () => {
    expect(() => sqliteDatetimeTextAtMilliseconds('2024-01-01T00:00:00.1234Z')).toThrow(
      CAST_REFUSED,
    );
  });
});
