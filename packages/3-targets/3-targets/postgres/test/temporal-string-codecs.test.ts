/**
 * The `*-string` temporal codecs exist so that every value PostgreSQL can render survives the round
 * trip, including the ones a richer temporal representation cannot express. Their contract is
 * therefore stated as identity rather than as a set of accepted formats: whatever the server sent
 * comes back byte-for-byte, and whatever the application supplied is bound byte-for-byte.
 */

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
} from '../src/core/codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

// Renderings PostgreSQL produces or accepts that no `Temporal.*` type can hold — the reason this
// representation exists. `DateStyle` and `TimeZone` are session settings, so the last three are
// what a non-default session hands back for the very same stored value.
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

const CODECS = [
  { id: PG_DATE_STRING_CODEC_ID, descriptor: pgDateStringDescriptor, nativeType: 'date' },
  {
    id: PG_TIMESTAMP_STRING_CODEC_ID,
    descriptor: pgTimestampStringDescriptor,
    nativeType: 'timestamp without time zone',
  },
  {
    id: PG_TIMESTAMPTZ_STRING_CODEC_ID,
    descriptor: pgTimestamptzStringDescriptor,
    nativeType: 'timestamp with time zone',
  },
  { id: PG_TIME_STRING_CODEC_ID, descriptor: pgTimeStringDescriptor, nativeType: 'time' },
] as const;

function withoutTemporalGlobal<T>(body: () => T): T {
  const had = Object.hasOwn(globalThis, 'Temporal');
  const original = Reflect.get(globalThis, 'Temporal');
  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    expect('Temporal' in globalThis).toBe(false);
    return body();
  } finally {
    if (had) {
      Reflect.set(globalThis, 'Temporal', original);
    }
  }
}

describe('representation-explicit temporal string codecs', () => {
  for (const { id, descriptor, nativeType } of CODECS) {
    describe(id, () => {
      const codec = descriptor.factory({})(instanceCtx);

      it('proxies its id through the descriptor', () => {
        expect(codec.id).toBe(id);
      });

      it.each(UNREPRESENTABLE_VALUES)('forwards %s unchanged in every direction', async (value) => {
        expect(await codec.encode(value, callCtx)).toBe(value);
        expect(await codec.decode(value, callCtx)).toBe(value);
        expect(codec.encodeJson(value)).toBe(value);
        expect(codec.decodeJson(value)).toBe(value);
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

      it('projects to JSON without altering the expression', () => {
        const expression = { marker: 'projection-input' };
        expect(descriptor.projectJson(expression as never, { codecId: id })).toBe(expression);
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
    const results = await withoutTemporalGlobal(async () =>
      Promise.all(
        CODECS.map(async ({ descriptor }) => {
          const codec = descriptor.factory({})(instanceCtx);
          const encoded = await codec.encode('infinity', callCtx);
          return codec.decode(encoded, callCtx);
        }),
      ),
    );

    expect(results).toEqual(['infinity', 'infinity', 'infinity', 'infinity']);
  });
});
