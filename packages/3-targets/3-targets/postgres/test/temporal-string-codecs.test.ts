import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgDateStringDescriptor,
  pgTimeStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

const UNREPRESENTABLE_VALUES = [
  'infinity',
  '-infinity',
  '0044-03-15 BC',
  '12026-01-02 03:04:05',
  '2026-01-02 03:04:05.123456+00',
  '24:00:00',
  '02.01.2026',
  '01/02/2026 03:04:05.123456 CET',
  'Thu Jan 02 03:04:05.123456 2026 PST',
] as const;

const OTHER_DATE_STYLES = [
  '02.01.2026',
  '01/02/2026 03:04:05.123456 CET',
  'Thu Jan 02 03:04:05.123456 2026 PST',
] as const;

const CODECS = [
  {
    id: PG_DATE_STRING_CODEC_ID,
    descriptor: pgDateStringDescriptor,
    nativeType: 'date',
    standardJson: [
      ['2026-01-02', '2026-01-02'],
      ['0044-03-15 BC', '-000043-03-15'],
      ['infinity', 'infinity'],
    ],
    refusedJson: ['02.01.2026', '2026-01-02 03:04:05'],
  },
  {
    id: PG_TIMESTAMP_STRING_CODEC_ID,
    descriptor: pgTimestampStringDescriptor,
    nativeType: 'timestamp without time zone',
    standardJson: [
      ['2026-01-02 03:04:05.123456', '2026-01-02T03:04:05.123456'],
      ['12026-01-02 03:04:05', '+012026-01-02T03:04:05'],
      ['-infinity', '-infinity'],
    ],
    refusedJson: ['01/02/2026 03:04:05.123456 CET', '2026-01-02 03:04:05.123456+00'],
  },
  {
    id: PG_TIMESTAMPTZ_STRING_CODEC_ID,
    descriptor: pgTimestamptzStringDescriptor,
    nativeType: 'timestamp with time zone',
    standardJson: [
      ['2026-01-02 03:04:05.123456+00', '2026-01-02T03:04:05.123456Z'],
      ['0044-03-15 00:00:00+00 BC', '-000043-03-15T00:00:00Z'],
      ['infinity', 'infinity'],
    ],
    refusedJson: ['Thu Jan 02 03:04:05.123456 2026 PST', '12026-01-02 03:04:05'],
  },
  {
    id: PG_TIME_STRING_CODEC_ID,
    descriptor: pgTimeStringDescriptor,
    nativeType: 'time',
    standardJson: [['03:04:05.123000', '03:04:05.123']],
    refusedJson: ['24:00:00', 'infinity'],
  },
] as const;

async function withoutTemporalGlobal<T>(body: () => Promise<T>): Promise<T> {
  const had = Object.hasOwn(globalThis, 'Temporal');
  const original = Reflect.get(globalThis, 'Temporal');
  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    return await body();
  } finally {
    if (had) {
      Reflect.set(globalThis, 'Temporal', original);
    }
  }
}

describe('representation-explicit temporal string codecs', () => {
  for (const { id, descriptor, nativeType, standardJson, refusedJson } of CODECS) {
    describe(id, () => {
      const codec = descriptor.factory({})(instanceCtx);

      it('proxies its id through the descriptor', () => {
        expect(codec.id).toBe(id);
      });

      it.each(UNREPRESENTABLE_VALUES)('forwards %s unchanged on the wire', async (value) => {
        expect({
          encoded: await codec.encode(value, callCtx),
          decoded: await codec.decode(value, callCtx),
        }).toEqual({ encoded: value, decoded: value });
      });

      it.each(OTHER_DATE_STYLES)(
        'refuses to read %s from JSON, which only a session in another DateStyle writes',
        (value) => {
          expect(() => codec.decodeJson(value)).toThrow(
            expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
          );
        },
      );

      it.each(standardJson.map(([value, json]) => ({ value, json })))(
        'writes $value to JSON in canonical form $json',
        ({ value, json }) => {
          expect(codec.encodeJson(value)).toBe(json);
        },
      );

      it.each(refusedJson)('refuses to write %s to JSON, as its data type does', (value) => {
        expect(() => codec.encodeJson(value)).toThrow(
          expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
        );
      });

      it('declares no target types, so introspection ownership stays with the temporal codecs', () => {
        expect({
          codecId: descriptor.codecId,
          traits: descriptor.traits,
          targetTypes: descriptor.targetTypes,
          nativeType: descriptor.nativeTypeFor({ codecId: id }),
        }).toEqual({
          codecId: id,
          traits: ['equality', 'order'],
          targetTypes: [],
          nativeType,
        });
      });

      it('projects to JSON through a text cast, so a nested read matches a flat one', () => {
        const expression = ColumnRef.of('moments', 'value');

        expect(descriptor.projectJson(expression, { codecId: id })).toEqual(
          CastExpr.as(expression, 'text'),
        );
      });
    });
  }

  describe('emitted read types', () => {
    it('renders the precision-bearing spellings the adapter imports', () => {
      expect([
        pgTimestampStringDescriptor.renderOutputType({ precision: 6 }),
        pgTimestamptzStringDescriptor.renderOutputType({ precision: 3 }),
        pgTimeStringDescriptor.renderOutputType({ precision: 0 }),
      ]).toEqual(['TimestampString<6>', 'TimestamptzString<3>', 'TimeString<0>']);
    });

    it('renders the bare spelling when the column declares no precision', () => {
      expect([
        pgTimestampStringDescriptor.renderOutputType({}),
        pgTimestamptzStringDescriptor.renderOutputType({}),
        pgTimeStringDescriptor.renderOutputType({}),
      ]).toEqual(['TimestampString', 'TimestamptzString', 'TimeString']);
    });

    it('leaves pg/date-string@1 without a renderer, since a date carries no precision', () => {
      expect(pgDateStringDescriptor.renderOutputType).toBeUndefined();
    });
  });

  it('encodes and decodes with no global Temporal available', async () => {
    const standIn = { note: 'stands in for a host Temporal implementation' };
    const hadHostTemporal = Object.hasOwn(globalThis, 'Temporal');
    const hostTemporal = Reflect.get(globalThis, 'Temporal');
    Reflect.set(globalThis, 'Temporal', standIn);
    const seenDuring: unknown[] = [];

    try {
      const results = await withoutTemporalGlobal(async () => {
        const decoded: string[] = [];
        for (const { descriptor } of CODECS) {
          const codec = descriptor.factory({})(instanceCtx);
          const encoded = await codec.encode('infinity', callCtx);
          seenDuring.push(Reflect.get(globalThis, 'Temporal'));
          decoded.push(await codec.decode(encoded, callCtx));
        }
        return decoded;
      });

      expect(seenDuring).toEqual([undefined, undefined, undefined, undefined]);
      expect(results).toEqual(['infinity', 'infinity', 'infinity', 'infinity']);
      expect(Reflect.get(globalThis, 'Temporal')).toBe(standIn);
    } finally {
      if (hadHostTemporal) {
        Reflect.set(globalThis, 'Temporal', hostTemporal);
      } else {
        Reflect.deleteProperty(globalThis, 'Temporal');
      }
    }
  });

  it('leaves the host Temporal global exactly as it found it', () => {
    expect(Object.hasOwn(globalThis, 'Temporal')).toBe(true);
    expect(Reflect.get(globalThis, 'Temporal')).toBe(Temporal);
  });
});
