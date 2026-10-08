import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';
import { fromContractJson, toContractJson } from './contract-json';

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
  ])('reads the wire text %s', async (wire, iso) => {
    expect(await codec.fromWire(wire, {})).toEqual(new Date(iso));
  });

  it.each([
    ['2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05.123Z'],
    ['2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05Z'],
    ['0000-01-01T00:00:00.000Z', '0001-01-01T00:00:00.000Z BC', '0000-01-01T00:00:00Z'],
    ['-000043-03-15T00:00:00.000Z', '0044-03-15T00:00:00.000Z BC', '-000043-03-15T00:00:00Z'],
    ['-004713-11-24T00:00:00.000Z', '4714-11-24T00:00:00.000Z BC', '-004713-11-24T00:00:00Z'],
    ['+275760-09-13T00:00:00.000Z', '275760-09-13T00:00:00.000Z', '+275760-09-13T00:00:00Z'],
    ['+012026-01-02T03:04:05.000Z', '12026-01-02T03:04:05.000Z', '+012026-01-02T03:04:05Z'],
  ])(
    'encodes %s as PostgreSQL text on the wire and in canonical form in JSON',
    async (iso, wire, json) => {
      const value = new Date(iso);
      expect({
        wire: await codec.toWire(value, {}),
        json: toContractJson(codec, value),
        fromWire: await codec.fromWire(wire, {}),
        fromJson: fromContractJson(codec, json),
      }).toEqual({ wire, json, fromWire: value, fromJson: value });
    },
  );

  it.each([
    ['2026-01-02 03:04:05.123456+00', '2026-01-02T03:04:05.123456Z'],
    ['2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05Z'],
    ['0044-03-15T00:00:00.000Z BC', '-000043-03-15T00:00:00Z'],
  ])('refuses the JSON %s, which is not the stored form %s', (json, stored) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: `pg/timestamptz JSON value must be "${stored}", as pg/timestamptz stores this value`,
      }),
    );
  });

  it.each([
    ['infinity', { codecId: 'pg/timestamptz-date@1' }],
    ['-infinity', { codecId: 'pg/timestamptz-date@1' }],
    ['garbage', { dataType: 'pg/timestamptz' }],
    ['2026-02-30 00:00:00+00', { dataType: 'pg/timestamptz' }],
    ['2026-01-01 00:00:00', { dataType: 'pg/timestamptz' }],
    ['2026-01-01', { dataType: 'pg/timestamptz' }],
    ['294276-01-01 00:00:00+00', { dataType: 'pg/timestamptz' }],
    ['2026-01-01 00:00:00+25', { dataType: 'pg/timestamptz' }],
    ['2026-01-01 00:00:00+00:60', { dataType: 'pg/timestamptz' }],
  ])('rejects unrepresentable or unsupported text: %s', async (wire, refusedBy) => {
    await expect(codec.fromWire(wire, {})).rejects.toThrow('pg/timestamptz-date@1');
    expect(() => fromContractJson(codec, wire)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining(refusedBy),
      }),
    );
  });

  describe.each(['wire', 'JSON'] as const)('%s PostgreSQL lower bound', (format) => {
    it.each([
      ['4714-11-23 23:59:59.999+00 BC', '-004713-11-23T23:59:59.999Z'],
      ['4714-11-23 23:59:59.999999+00 BC', '-004713-11-23T23:59:59.999999Z'],
      ['4714-11-24 00:59:59.999+01 BC', '-004713-11-23T23:59:59.999Z'],
      ['4714-11-24 00:00:00+01 BC', '-004713-11-23T23:00:00Z'],
      ['4715-01-01 00:00:00+00 BC', '-004714-01-01T00:00:00Z'],
    ])('rejects text before the UTC boundary: %s', async (wire, json) => {
      if (format === 'wire') {
        await expect(codec.fromWire(wire, {})).rejects.toThrow(RangeError);
      } else {
        expect(() => fromContractJson(codec, json)).toThrow(
          expect.objectContaining({
            code: 'RUNTIME.DECODE_FAILED',
            meta: { dataType: 'pg/timestamptz', received: JSON.stringify(json) },
          }),
        );
      }
    });

    it.each(['-004713-11-23T23:59:59.999Z', '-004714-01-01T00:00:00.000Z'])(
      'rejects a finite Date before the boundary: %s',
      async (iso) => {
        const value = new Date(iso);
        expect(Number.isFinite(value.getTime())).toBe(true);
        if (format === 'wire') {
          await expect(codec.toWire(value, {})).rejects.toThrow(RangeError);
        } else {
          expect(() => toContractJson(codec, value)).toThrow(RangeError);
        }
      },
    );
  });

  it.each([new Date(Number.NaN), '2026-01-01', 0, null])(
    'rejects invalid Date input %s',
    async (value) => {
      await expect(codec.toWire(value as Date, {})).rejects.toThrow('pg/timestamptz-date@1');
      expect(() => toContractJson(codec, value as Date)).toThrow('pg/timestamptz-date@1');
    },
  );

  it.each([
    [null, 'null'],
    [0, '0'],
    [{}, '{}'],
    [[], '[]'],
  ])('rejects non-string JSON %s', (value, received) => {
    expect(() => fromContractJson(codec, value)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { dataType: 'pg/timestamptz', received },
      }),
    );
  });

  it('projects nested timestamps through the same text format as flat reads', () => {
    const expression = ColumnRef.of('events', 'createdAt');
    expect(pgTimestamptzDateDescriptor.projectJson(expression, { codecId: codec.id })).toEqual(
      CastExpr.as(expression, 'text'),
    );
    expect(pgTimestamptzDateDescriptor.renderOutputType({ precision: 6 })).toBe('Date');
  });
});
