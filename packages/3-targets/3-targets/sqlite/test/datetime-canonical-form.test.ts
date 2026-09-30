import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';
import { sqliteDatetimeText } from '../src/core/data-types';

describe('sqlite/datetime standard text', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T01:00:00+01:00', '2024-01-01T00:00:00Z'],
    ['2024-01-01 00:00:00+00', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.120Z', '2024-01-01T00:00:00.12Z'],
    ['-000043-03-15T00:00:00.000Z', '-000043-03-15T00:00:00Z'],
    ['+012026-01-02T03:04:05Z', '+012026-01-02T03:04:05Z'],
  ];

  it.each(accepted)('turns %s into %s', (written, standard) => {
    expect(sqliteDatetimeText(written)).toBe(standard);
  });

  it.each(accepted)('agrees with Temporal.Instant on %s', (written) => {
    expect(sqliteDatetimeText(written)).toBe(Temporal.Instant.from(written).toString());
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
      '2024-01-01T00:00:00.1234567Z',
      '"2024-01-01T00:00:00.1234567Z" has 7 digits after the decimal point, but sqlite/datetime keeps at most 6, which is microseconds. Round it, as in "2024-01-01T12:34:56.123456Z".',
    ],
  ])('refuses %s', (written, message) => {
    expect(() => sqliteDatetimeText(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('sqlite/datetime@1 JSON text', () => {
  const codec = sqliteDatetimeDescriptor.factory()({ name: '<test>' });

  it('writes a Date as the standard text', () => {
    expect([
      codec.encodeJson(new Date('2024-01-01T00:00:00.000Z')),
      codec.encodeJson(new Date('2024-01-01T00:00:00.250Z')),
      codec.encodeJson(new Date('-000043-03-15T00:00:00.000Z')),
    ]).toEqual(['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.25Z', '-000043-03-15T00:00:00Z']);
  });

  it('still reads the millisecond text it wrote before the standard text', () => {
    expect(codec.decodeJson('2024-01-01T00:00:00.000Z')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });
});
