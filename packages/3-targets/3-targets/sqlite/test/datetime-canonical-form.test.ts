import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';
import { sqliteDatetime, sqliteDatetimeCanonical, sqliteText } from '../src/core/data-types';

describe('sqlite/datetime canonical form', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00Z'],
    ['2024-01-01T01:00:00+01:00', '2024-01-01T00:00:00Z'],
    ['2024-01-01 00:00:00+00', '2024-01-01T00:00:00Z'],
    ['2024-01-01T00:00:00.120Z', '2024-01-01T00:00:00.12Z'],
    ['2024-01-01T00:00:00.123Z', '2024-01-01T00:00:00.123Z'],
    ['-000043-03-15T00:00:00.000Z', '-000043-03-15T00:00:00Z'],
    ['+012026-01-02T03:04:05Z', '+012026-01-02T03:04:05Z'],
    ['+275760-09-13T00:00:00Z', '+275760-09-13T00:00:00Z'],
    ['-271821-04-20T00:00:00Z', '-271821-04-20T00:00:00Z'],
  ];

  it.each(accepted)('turns %s into its canonical form %s', (written, canonical) => {
    expect(sqliteDatetimeCanonical(written)).toBe(canonical);
  });

  it.each(accepted)('agrees with Temporal.Instant on %s', (written) => {
    expect(sqliteDatetimeCanonical(written)).toBe(Temporal.Instant.from(written).toString());
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
      '2024-01-01T00:00:00.123456Z',
      '"2024-01-01T00:00:00.123456Z" has 6 digits after the decimal point, but sqlite/datetime holds milliseconds, so at most 3. Round it, as in "2024-01-01T12:34:56.123Z".',
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
    expect(() => sqliteDatetimeCanonical(written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });
});

describe('sqlite/datetime declares its canonical form', () => {
  it('gives the type its canonical-form function, which its cast from text shares', () => {
    expect({
      canonical: sqliteDatetime.toCanonicalForm?.('2024-01-01 01:00:00+01:00'),
      cast: sqliteDatetime.casts[sqliteText.id]?.('2024-01-01 01:00:00+01:00'),
    }).toEqual({ canonical: '2024-01-01T00:00:00Z', cast: '2024-01-01T00:00:00Z' });
  });
});

describe('sqlite/datetime@1 JSON text', () => {
  const codec = sqliteDatetimeDescriptor.factory()({ name: '<test>' });

  it('writes a Date in canonical form', () => {
    expect([
      codec.encodeJson(new Date('2024-01-01T00:00:00.000Z')),
      codec.encodeJson(new Date('2024-01-01T00:00:00.250Z')),
      codec.encodeJson(new Date('-000043-03-15T00:00:00.000Z')),
    ]).toEqual(['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.25Z', '-000043-03-15T00:00:00Z']);
  });

  it('still reads the millisecond text it wrote before the canonical form', () => {
    expect(codec.decodeJson('2024-01-01T00:00:00.000Z')).toEqual(
      new Date('2024-01-01T00:00:00.000Z'),
    );
  });
});
