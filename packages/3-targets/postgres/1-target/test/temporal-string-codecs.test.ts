import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
} from '../src/core/codec-ids';
import { pgTimetzDescriptor } from '../src/core/codecs';
import {
  pgDateStringDescriptor,
  pgTimeStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';
import { fromContractJson, toContractJson } from './contract-json';

const instanceCtx = { name: '<test>' };
const callCtx = {};

const OTHER_DATE_STYLES = [
  '02.01.2026',
  '01/02/2026 03:04:05.123456 CET',
  'Thu Jan 02 03:04:05.123456 2026 PST',
] as const;

interface StringCodecCase {
  readonly id: string;
  readonly descriptor:
    | typeof pgDateStringDescriptor
    | typeof pgTimestampStringDescriptor
    | typeof pgTimestamptzStringDescriptor
    | typeof pgTimeStringDescriptor
    | typeof pgTimetzDescriptor;
  /** Text PostgreSQL prints under DateStyle ISO, and the stored form the codec reads it as. */
  readonly read: readonly (readonly [wire: string, stored: string])[];
  /** A stored value, and the text the codec sends PostgreSQL for it. */
  readonly written: readonly (readonly [stored: string, wire: string])[];
  /** Text PostgreSQL reads that is not the stored form, which `toDataTypeValue` refuses. */
  readonly notStored: readonly string[];
  /** Whether PostgreSQL prints the type under the session's DateStyle. */
  readonly printedUnderDateStyle: boolean;
  /** Whether a JSON row carries the value through a text cast, rather than as the JSON PostgreSQL writes for it. */
  readonly projectsThroughText: boolean;
}

const CODECS: readonly StringCodecCase[] = [
  {
    id: PG_DATE_STRING_CODEC_ID,
    descriptor: pgDateStringDescriptor,
    read: [
      ['2026-01-02', '2026-01-02'],
      ['0044-03-15 BC', '-000043-03-15'],
      ['4713-11-24 BC', '-004712-11-24'],
      ['12026-01-02', '+012026-01-02'],
      ['5874897-12-31', '+5874897-12-31'],
      ['infinity', 'infinity'],
      ['-infinity', '-infinity'],
    ],
    written: [
      ['2026-01-02', '2026-01-02'],
      ['-000043-03-15', '0044-03-15 BC'],
      ['+012026-01-02', '12026-01-02'],
      ['infinity', 'infinity'],
    ],
    notStored: ['0044-03-15 BC', '12026-01-02'],
    printedUnderDateStyle: true,
    projectsThroughText: true,
  },
  {
    id: PG_TIMESTAMP_STRING_CODEC_ID,
    descriptor: pgTimestampStringDescriptor,
    read: [
      ['2026-01-02 03:04:05.123456', '2026-01-02T03:04:05.123456'],
      ['2026-01-02 03:04:05', '2026-01-02T03:04:05'],
      ['0044-03-15 12:00:00 BC', '-000043-03-15T12:00:00'],
      ['294276-12-31 23:59:59.999999', '+294276-12-31T23:59:59.999999'],
      ['-infinity', '-infinity'],
    ],
    written: [
      ['2026-01-02T03:04:05.123456', '2026-01-02T03:04:05.123456'],
      ['-000043-03-15T12:00:00', '0044-03-15T12:00:00 BC'],
      ['+012026-01-02T03:04:05', '12026-01-02T03:04:05'],
    ],
    notStored: ['2026-01-02 03:04:05.123456', '2024-01-01T12:34:56.50'],
    printedUnderDateStyle: true,
    projectsThroughText: true,
  },
  {
    id: PG_TIMESTAMPTZ_STRING_CODEC_ID,
    descriptor: pgTimestamptzStringDescriptor,
    read: [
      ['2026-01-02 03:04:05.123456+00', '2026-01-02T03:04:05.123456Z'],
      ['2026-01-02 12:04:05.123456+09', '2026-01-02T03:04:05.123456Z'],
      ['2024-01-01 01:00:00+01', '2024-01-01T00:00:00Z'],
      ['2025-12-31 20:30:00-03:30', '2026-01-01T00:00:00Z'],
      ['1800-01-01 00:17:30+00:17:30', '1800-01-01T00:00:00Z'],
      ['0044-03-15 12:00:00+00 BC', '-000043-03-15T12:00:00Z'],
      ['294276-12-31 23:59:59+00', '+294276-12-31T23:59:59Z'],
      ['infinity', 'infinity'],
    ],
    written: [
      ['2026-01-02T03:04:05.123456Z', '2026-01-02T03:04:05.123456Z'],
      ['-000043-03-15T12:00:00Z', '0044-03-15T12:00:00Z BC'],
    ],
    notStored: ['2026-01-02 03:04:05.123456+00', '2024-01-01T01:00:00+01:00'],
    printedUnderDateStyle: true,
    projectsThroughText: true,
  },
  {
    id: PG_TIME_STRING_CODEC_ID,
    descriptor: pgTimeStringDescriptor,
    read: [
      ['03:04:05.123456', '03:04:05.123456'],
      ['00:00:00', '00:00:00'],
      ['24:00:00', '24:00:00'],
    ],
    written: [['03:04:05.5', '03:04:05.5']],
    notStored: ['12:34', '03:04:05.50'],
    printedUnderDateStyle: false,
    projectsThroughText: true,
  },
  {
    id: PG_TIMETZ_CODEC_ID,
    descriptor: pgTimetzDescriptor,
    read: [
      ['12:34:56+02', '12:34:56+02:00'],
      ['03:04:05+00', '03:04:05Z'],
      ['12:00:00+01:30:15', '12:00:00+01:30:15'],
      ['12:00:00-15:59', '12:00:00-15:59'],
      ['12:34:56.123456+05:45', '12:34:56.123456+05:45'],
      ['24:00:00+00', '24:00:00Z'],
      ['24:00:00-02', '24:00:00-02:00'],
    ],
    written: [['12:34:56+02:00', '12:34:56+02:00']],
    notStored: ['12:34:56+02', '03:04:05+00'],
    printedUnderDateStyle: false,
    projectsThroughText: false,
  },
];

describe('the string date and time codecs', () => {
  for (const {
    id,
    descriptor,
    read,
    written,
    notStored,
    printedUnderDateStyle,
    projectsThroughText,
  } of CODECS) {
    describe(id, () => {
      const codec = descriptor.factory({})(instanceCtx);

      it.each(read.map(([wire, stored]) => ({ wire, stored })))(
        'reads the text PostgreSQL prints, $wire, as its stored form $stored',
        async ({ wire, stored }) => {
          expect(await codec.fromWire(wire, callCtx)).toBe(stored);
        },
      );

      it.each(written.map(([stored, wire]) => ({ stored, wire })))(
        'writes $stored as $wire, which PostgreSQL reads',
        async ({ stored, wire }) => {
          expect(await codec.toWire(stored, callCtx)).toBe(wire);
        },
      );

      it.each(written.map(([stored]) => stored))(
        'stores %s in the contract as it is and reads it back unchanged',
        (stored) => {
          const json = toContractJson(codec, stored);
          expect({ json, read: fromContractJson(codec, json) }).toEqual({
            json: stored,
            read: stored,
          });
        },
      );

      it.each(notStored)('refuses to store %s, which is not its stored form', (value) => {
        expect(() => toContractJson(codec, value)).toThrow(
          expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
        );
      });

      if (printedUnderDateStyle) {
        it.each(OTHER_DATE_STYLES)(
          'refuses %s, which PostgreSQL prints only under another DateStyle, naming the setting',
          async (wire) => {
            await expect(codec.fromWire(wire, callCtx)).rejects.toMatchObject({
              code: 'RUNTIME.DATE_STYLE_NOT_ISO',
              message: expect.stringContaining('the driver could not ensure'),
              fix: expect.stringContaining('DateStyle'),
              meta: { codecId: id, received: wire },
            });
          },
        );
      }

      it.each(OTHER_DATE_STYLES)(
        'refuses to read %s from JSON, which only a session in another DateStyle writes',
        (value) => {
          expect(() => fromContractJson(codec, value)).toThrow(
            expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
          );
        },
      );

      it('projects to JSON as text or as the JSON PostgreSQL writes, both of which fromWire reads', () => {
        const expression = ColumnRef.of('moments', 'value');

        expect(descriptor.projectJson(expression, { codecId: id })).toEqual(
          projectsThroughText ? CastExpr.as(expression, 'text') : expression,
        );
      });
    });
  }

  it('writes a date it reads with a seven-digit year, which is beyond the stored range, back as PostgreSQL reads it', async () => {
    const codec = pgDateStringDescriptor.factory()(instanceCtx);
    const read = await codec.fromWire('5874897-12-31', callCtx);

    expect({ read, written: await codec.toWire(read, callCtx) }).toEqual({
      read: '+5874897-12-31',
      written: '5874897-12-31',
    });
  });

  it('reads and writes with no global Temporal available', async () => {
    const had = Object.hasOwn(globalThis, 'Temporal');
    const original = Reflect.get(globalThis, 'Temporal');
    Reflect.deleteProperty(globalThis, 'Temporal');
    try {
      const results: string[] = [];
      for (const { descriptor, read } of CODECS) {
        const codec = descriptor.factory({})(instanceCtx);
        const [wire = ''] = read[1] ?? [];
        results.push(await codec.fromWire(await codec.toWire(wire, callCtx), callCtx));
      }
      expect(results).toEqual(CODECS.map(({ read }) => read[1]?.[1]));
    } finally {
      if (had) Reflect.set(globalThis, 'Temporal', original);
    }
  });

  it('leaves the host Temporal global exactly as it found it', () => {
    expect(Object.hasOwn(globalThis, 'Temporal')).toBe(true);
    expect(Reflect.get(globalThis, 'Temporal')).toBe(Temporal);
  });
});
