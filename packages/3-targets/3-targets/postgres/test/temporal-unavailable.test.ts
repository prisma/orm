import { describe, expect, it } from 'vitest';
import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from '../src/core/codec-ids';
import { codecDescriptors } from '../src/core/codecs';
import { instantNow } from '../src/core/instant-now-generator';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';
import {
  pgDateTemporalColumn,
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
} from '../src/core/temporal-codecs';
import { pgDateStringDescriptor } from '../src/core/temporal-string-codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

async function withoutTemporal<T>(body: () => Promise<T>): Promise<T> {
  const original = Reflect.get(globalThis, 'Temporal');
  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    return await body();
  } finally {
    Reflect.set(globalThis, 'Temporal', original);
  }
}

describe('Temporal-backed codecs in a runtime without Temporal', () => {
  it('registers descriptors, resolves them, and builds columns without touching Temporal', async () => {
    const observed = await withoutTemporal(async () => {
      await Promise.resolve();
      return {
        temporalStillGone: 'Temporal' in globalThis,
        registered: codecDescriptors.some((d) => d.codecId === PG_DATE_TEMPORAL_CODEC_ID),
        resolvedById: postgresCodecDescriptorRegistry.descriptorFor(
          PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
        )?.codecId,
        nativeType: pgTimestampTemporalDescriptor.nativeTypeFor({
          codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
        }),
        columnCodecId: pgDateTemporalColumn().codecId,
        instantiated: pgDateTemporalDescriptor.factory()(instanceCtx).id,
      };
    });

    expect(observed).toEqual({
      temporalStillGone: false,
      registered: true,
      resolvedById: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
      nativeType: 'timestamp without time zone',
      columnCodecId: PG_DATE_TEMPORAL_CODEC_ID,
      instantiated: PG_DATE_TEMPORAL_CODEC_ID,
    });
  });

  it('fails only when a Temporal codec is actually invoked, naming the codec and the way out', async () => {
    const codecs = [
      [PG_DATE_TEMPORAL_CODEC_ID, pgDateTemporalDescriptor.factory()(instanceCtx)],
      [PG_TIMESTAMP_TEMPORAL_CODEC_ID, pgTimestampTemporalDescriptor.factory({})(instanceCtx)],
      [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID, pgTimestamptzTemporalDescriptor.factory({})(instanceCtx)],
      [PG_TIME_TEMPORAL_CODEC_ID, pgTimeTemporalDescriptor.factory({})(instanceCtx)],
    ] as const;

    const outcomes = await withoutTemporal(async () => {
      const results: Array<{ codecId: string; code: unknown; namesCodec: boolean }> = [];
      for (const [codecId, codec] of codecs) {
        await Promise.resolve();
        try {
          await codec.decode('2026-01-02', callCtx);
          results.push({ codecId, code: 'DID NOT THROW', namesCodec: false });
        } catch (error) {
          const structured = error as { code?: unknown; message?: string };
          results.push({
            codecId,
            code: structured.code,
            namesCodec: (structured.message ?? '').includes(codecId),
          });
        }
      }
      return results;
    });

    expect(outcomes).toEqual(
      codecs.map(([codecId]) => ({
        codecId,
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        namesCodec: true,
      })),
    );
  });

  it('leaves the string codecs completely unaffected', async () => {
    const decoded = await withoutTemporal(async () => {
      const codec = pgDateStringDescriptor.factory()(instanceCtx);
      const encoded = await codec.encode('infinity', callCtx);
      return codec.decode(encoded, callCtx);
    });

    expect(decoded).toBe('infinity');
  });

  it('fails the instantNow generator with the capability error, naming its *String alternative', async () => {
    const outcome = await withoutTemporal(async () => {
      await Promise.resolve();
      try {
        instantNow();
        return { threw: false };
      } catch (error) {
        const structured = error as { code?: string; fix?: string; meta?: Record<string, unknown> };
        return {
          threw: true,
          code: structured.code,
          namesTheStringPreset: (structured.fix ?? '').includes('updatedAtString'),
          meta: structured.meta,
        };
      }
    });

    expect(outcome).toEqual({
      threw: true,
      code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      namesTheStringPreset: true,
      meta: { generatorId: 'instantNow' },
    });
  });

  it('reads the clock through Temporal once one is available', () => {
    expect(instantNow()).toBeInstanceOf(Temporal.Instant);
  });

  it('restores whatever Temporal the host had once the window closes', () => {
    expect(typeof Temporal.PlainDate.from('2026-01-02').toString()).toBe('string');
  });
});
