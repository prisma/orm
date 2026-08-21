/**
 * The `*-string` temporal codecs exist so that every value PostgreSQL can render survives the round
 * trip, including the ones a richer temporal representation cannot express. Their contract is
 * therefore stated as identity rather than as a set of accepted formats: whatever the server sent
 * comes back byte-for-byte, and whatever the application supplied is bound byte-for-byte.
 */

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

/**
 * Runs `body` with no global `Temporal`, restoring whatever was there afterwards. `await body()`
 * rather than `return body()` is the whole point: the window has to span the codec calls, not just
 * the synchronous act of starting them, or the global comes back before any `decode` runs.
 */
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

      // Was an identity projection, which let PostgreSQL choose the JSON spelling and so disagreed
      // with a flat read of the same column. The cast makes both paths return the server's text.
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
    // This Node has no `Temporal`, so deleting nothing would prove nothing. Installing a stand-in
    // first gives the helper something to remove, which is what makes the assertions below
    // discriminating: sampled after an await, `seenDuring` reports the window the codecs actually
    // ran in. A helper that restored the global before awaiting would hand back the stand-in.
    const standIn = { note: 'stands in for a host Temporal implementation' };
    // Save what was there before overwriting it. This suite installs a real polyfill in its setup
    // file, and deleting the stand-in on the way out — rather than restoring — would leave every
    // later test in the same worker without a global that its own setup had provided.
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
