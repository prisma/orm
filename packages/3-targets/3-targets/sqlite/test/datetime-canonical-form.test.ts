import { describe, expect, it } from 'vitest';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';
import { sqliteDatetime, sqliteDatetimeText } from '../src/core/data-types';
import { fromContractJson, toContractJson } from './contract-json';

describe('the value of sqlite/datetime', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T01:00:00+01:00', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01 00:00:00+00', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T00:00:00.120Z', '2024-01-01T00:00:00.120Z'],
    ['2024-01-01T00:00:00.5Z', '2024-01-01T00:00:00.500Z'],
    ['2024-01-01T00:00:00.123Z', '2024-01-01T00:00:00.123Z'],
    ['-000043-03-15T00:00:00.000Z', '-000043-03-15T00:00:00.000Z'],
    ['+012026-01-02T03:04:05Z', '+012026-01-02T03:04:05.000Z'],
    ['+275760-09-13T00:00:00Z', '+275760-09-13T00:00:00.000Z'],
    ['-271821-04-20T00:00:00Z', '-271821-04-20T00:00:00.000Z'],
  ];

  it.each(accepted)('is written for %s as %s', (written, stored) => {
    expect(sqliteDatetimeText(written)).toBe(stored);
  });

  it.each(accepted)('is what toISOString() writes for %s', (written) => {
    expect(sqliteDatetimeText(written)).toBe(new Date(written).toISOString());
  });

  it.each([
    [
      '2024-01-01 00:00:00',
      'sqlite/datetime needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z".',
    ],
    [
      'infinity',
      'sqlite/datetime cannot read "infinity". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-02-30T00:00:00Z',
      '"2024-02-30T00:00:00Z" is not a date that exists. Write a real date, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '2024-01-01T00:00:00.1234Z',
      '"2024-01-01T00:00:00.1234Z" has 4 digits after the decimal point, but sqlite/datetime holds milliseconds, so at most 3. Round it, as in "2024-01-01T12:34:56.123Z".',
    ],
    [
      '0044-03-15 00:00:00+00 BC',
      'sqlite/datetime cannot read "0044-03-15 00:00:00+00 BC". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
    [
      '+275760-09-13T00:00:00.001Z',
      'sqlite/datetime holds instants from -271821-04-20T00:00:00Z to +275760-09-13T00:00:00Z, and "+275760-09-13T00:00:00.001Z" is outside them.',
    ],
    [
      '-271821-04-19T23:59:59Z',
      'sqlite/datetime holds instants from -271821-04-20T00:00:00Z to +275760-09-13T00:00:00Z, and "-271821-04-19T23:59:59Z" is outside them.',
    ],
  ])('refuses %s', (written, message) => {
    expect(() => sqliteDatetimeText(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('sqlite/datetime@1', () => {
  const codec = sqliteDatetimeDescriptor.factory()({ name: '<test>' });

  it('represents sqlite/datetime, which owns the value', () => {
    expect(sqliteDatetimeDescriptor.dataType).toBe(sqliteDatetime.id);
  });

  it('writes a Date as the text toISOString() writes', () => {
    expect([
      toContractJson(codec, new Date('2024-01-01T00:00:00.000Z')),
      toContractJson(codec, new Date('2024-01-01T00:00:00.250Z')),
      toContractJson(codec, new Date('-000043-03-15T00:00:00.000Z')),
    ]).toEqual([
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.250Z',
      '-000043-03-15T00:00:00.000Z',
    ]);
  });

  it('reads the stored value as the instant it names', () => {
    expect(fromContractJson(codec, '2024-01-01T00:00:00.000Z')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });

  it('refuses a stored value without three fraction digits', () => {
    expect(() => fromContractJson(codec, '2024-01-01T00:00:00Z')).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });
});
