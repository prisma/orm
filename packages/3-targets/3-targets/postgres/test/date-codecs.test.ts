import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';

const codec = pgTimestamptzDateDescriptor.factory({})({ name: 'test' });

describe('pg/timestamptz-date@1', () => {
  it.each([
    ['2026-01-02 03:04:05.123456+00', '2026-01-02T03:04:05.123Z'],
    ['2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05.123Z'],
    ['2026-01-02 03:04:05+05:30', '2026-01-01T21:34:05.000Z'],
    ['2026-01-02 03:04:05-08', '2026-01-02T11:04:05.000Z'],
    ['1900-01-01 00:00:00+00:09:21', '1899-12-31T23:50:39.000Z'],
    ['1969-12-31 23:59:59.999999+00', '1969-12-31T23:59:59.999Z'],
    ['0001-01-01 00:00:00+00', '0001-01-01T00:00:00.000Z'],
    ['0001-01-01 00:00:00+00 BC', '0000-01-01T00:00:00.000Z'],
    ['0044-03-15 00:00:00+00 BC', '-000043-03-15T00:00:00.000Z'],
    ['4714-11-24 00:00:00+00 BC', '-004713-11-24T00:00:00.000Z'],
    ['4714-11-24 01:00:00+01 BC', '-004713-11-24T00:00:00.000Z'],
    ['4714-11-23 23:00:00-01 BC', '-004713-11-24T00:00:00.000Z'],
    ['12026-01-02 03:04:05+00', '+012026-01-02T03:04:05.000Z'],
    ['275760-09-13 02:00:00+02', '+275760-09-13T00:00:00.000Z'],
  ])('decodes %s consistently in flat and JSON reads', async (wire, iso) => {
    expect(await codec.decode(wire, {})).toEqual(new Date(iso));
    expect(codec.decodeJson(wire)).toEqual(new Date(iso));
  });

  it.each([
    ['2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05.123Z'],
    ['0000-01-01T00:00:00.000Z', '0001-01-01T00:00:00.000Z BC'],
    ['-000043-03-15T00:00:00.000Z', '0044-03-15T00:00:00.000Z BC'],
    ['-004713-11-24T00:00:00.000Z', '4714-11-24T00:00:00.000Z BC'],
    ['+275760-09-13T00:00:00.000Z', '275760-09-13T00:00:00.000Z'],
    ['+012026-01-02T03:04:05.000Z', '12026-01-02T03:04:05.000Z'],
  ])('encodes %s as PostgreSQL-compatible UTC text', async (iso, wire) => {
    const value = new Date(iso);
    expect(await codec.encode(value, {})).toBe(wire);
    expect(codec.encodeJson(value)).toBe(wire);
    expect(await codec.decode(wire, {})).toEqual(value);
  });

  it.each([
    'infinity',
    '-infinity',
    'garbage',
    '2026-02-30 00:00:00+00',
    '2026-01-01 00:00:00',
    '2026-01-01',
    '294276-01-01 00:00:00+00',
    '2026-01-01 00:00:00+25',
    '2026-01-01 00:00:00+00:60',
  ])('rejects unrepresentable or unsupported text: %s', async (wire) => {
    await expect(codec.decode(wire, {})).rejects.toThrow('pg/timestamptz-date@1');
    expect(() => codec.decodeJson(wire)).toThrow('pg/timestamptz-date@1');
  });

  describe.each(['wire', 'JSON'] as const)('%s PostgreSQL lower bound', (format) => {
    it.each([
      '4714-11-23 23:59:59.999+00 BC',
      '4714-11-23 23:59:59.999999+00 BC',
      '4714-11-24 00:59:59.999+01 BC',
      '4714-11-24 00:00:00+01 BC',
      '4715-01-01 00:00:00+00 BC',
    ])('rejects text before the UTC boundary: %s', async (wire) => {
      if (format === 'wire') {
        await expect(codec.decode(wire, {})).rejects.toThrow(RangeError);
      } else {
        expect(() => codec.decodeJson(wire)).toThrow(RangeError);
      }
    });

    it.each(['-004713-11-23T23:59:59.999Z', '-004714-01-01T00:00:00.000Z'])(
      'rejects a finite Date before the boundary: %s',
      async (iso) => {
        const value = new Date(iso);
        expect(Number.isFinite(value.getTime())).toBe(true);
        if (format === 'wire') {
          await expect(codec.encode(value, {})).rejects.toThrow(RangeError);
        } else {
          expect(() => codec.encodeJson(value)).toThrow(RangeError);
        }
      },
    );
  });

  it.each([new Date(Number.NaN), '2026-01-01', 0, null])(
    'rejects invalid Date input %s',
    async (value) => {
      await expect(codec.encode(value as Date, {})).rejects.toThrow('pg/timestamptz-date@1');
      expect(() => codec.encodeJson(value as Date)).toThrow('pg/timestamptz-date@1');
    },
  );

  it.each([null, 0, {}, []])('rejects non-string JSON %s', (value) => {
    expect(() => codec.decodeJson(value)).toThrow('pg/timestamptz-date@1');
  });

  it('projects nested timestamps through the same text format as flat reads', () => {
    const expression = ColumnRef.of('events', 'createdAt');
    expect(pgTimestamptzDateDescriptor.projectJson(expression, { codecId: codec.id })).toEqual(
      CastExpr.as(expression, 'text'),
    );
    expect(pgTimestamptzDateDescriptor.renderOutputType({ precision: 6 })).toBe('Date');
    expect(pgTimestamptzDateDescriptor.targetTypes).toEqual([]);
  });
});
