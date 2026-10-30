import { timeouts } from '@repo/test-utils';
import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostTemporal = Temporal;

type RequireTemporalModule = typeof import('@internal/type-implementations/temporal') &
  typeof import('../src/core/require-temporal');

async function freshModule(): Promise<RequireTemporalModule> {
  vi.resetModules();
  return {
    ...(await import('@internal/type-implementations/temporal')),
    ...(await import('../src/core/require-temporal')),
  };
}

const DECODE_A_DATE = { codecId: 'mysql/date-temporal@1', operation: 'decode' } as const;

const UNAVAILABLE_FOR_CODEC = expect.objectContaining({
  code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
  message:
    "Codec 'mysql/date-temporal@1' cannot decode a value because this runtime has no global Temporal implementation.",
  meta: { codecId: 'mysql/date-temporal@1', operation: 'decode' },
});

const call = {};
const ctx = { name: 'at' };

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'Temporal');
});

afterEach(() => {
  Reflect.set(globalThis, 'Temporal', hostTemporal);
});

describe('requireTemporal on MySQL', () => {
  it('returns the fallback when the runtime has no Temporal, and sets no global', async () => {
    const { setFallbackTemporal, requireTemporal } = await freshModule();
    setFallbackTemporal(otherTemporal);

    expect(requireTemporal(DECODE_A_DATE)).toBe(otherTemporal);
    expect('Temporal' in globalThis).toBe(false);
  });

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a codec and for a generator when there is neither', async () => {
    const { requireTemporal } = await freshModule();

    expect(() => requireTemporal(DECODE_A_DATE)).toThrow(UNAVAILABLE_FOR_CODEC);
    expect(() => requireTemporal({ generatorId: 'instantNow' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        meta: { generatorId: 'instantNow' },
      }),
    );
  });
});

describe('the MySQL Temporal codecs with a fallback and no global Temporal', () => {
  it('decode with the fallback', async () => {
    const { setFallbackTemporal } = await freshModule();
    const codecs = await import('../src/core/date-time-codecs');
    setFallbackTemporal(otherTemporal);

    const instant = await codecs.mysqlDatetimeTemporalDescriptor
      .factory({ precision: 6 })(ctx)
      .fromWire('2024-01-01 00:00:00.000000', call);
    const date = await codecs.mysqlDateTemporalDescriptor
      .factory()(ctx)
      .fromWire('2024-01-01', call);
    const time = await codecs.mysqlTimeTemporalDescriptor
      .factory({ precision: 6 })(ctx)
      .fromWire('12:34:56.000000', call);

    expect({
      instant: [instant instanceof otherTemporal.Instant, instant.toString()],
      date: [date instanceof otherTemporal.PlainDate, date.toString()],
      time: [time instanceof otherTemporal.PlainTime, time.toString()],
    }).toEqual({
      instant: [true, '2024-01-01T00:00:00Z'],
      date: [true, '2024-01-01'],
      time: [true, '12:34:56'],
    });
  });
});

describe('the MySQL date and time types with no global Temporal and no fallback', () => {
  it('decode a Temporal type with RUNTIME.TEMPORAL_UNAVAILABLE, and encode one, which constructs nothing', async () => {
    await freshModule();
    const codecs = await import('../src/core/date-time-codecs');
    const date = codecs.mysqlDateTemporalDescriptor.factory()(ctx);

    await expect(date.fromWire('2024-01-01', call)).rejects.toThrow(UNAVAILABLE_FOR_CODEC);
    expect(await date.toWire(otherTemporal.PlainDate.from('2024-01-01'), call)).toBe('2024-01-01');
  });

  it('read and write every default type, which needs no Temporal', async () => {
    await freshModule();
    const codecs = await import('../src/core/date-time-codecs');
    const { mysqlDatetimeDescriptor } = await import('../src/core/codecs');
    const datetime = mysqlDatetimeDescriptor.factory({ precision: 3 })(ctx);
    const date = codecs.mysqlDateStringDescriptor.factory()(ctx);
    const time = codecs.mysqlTimeStringDescriptor.factory({ precision: 6 })(ctx);
    const duration = codecs.mysqlDurationStringDescriptor.factory()(ctx);

    expect({
      datetime: (await datetime.fromWire(await datetime.toWire(new Date(0), call), call)).getTime(),
      date: await date.fromWire(await date.toWire('2024-02-29', call), call),
      time: await time.fromWire(await time.toWire('09:30', call), call),
      duration: await duration.fromWire(await duration.toWire('PT1H', call), call),
    }).toEqual({ datetime: 0, date: '2024-02-29', time: '09:30:00', duration: 'PT1H' });
  });
});

describe('which MySQL entries set the fallback', () => {
  it(
    'the control entry sets it and sets no global',
    async () => {
      const { requireTemporal } = await freshModule();
      await import('../src/exports/control');

      expect(requireTemporal(DECODE_A_DATE).PlainDate.from('2024-01-01').toString()).toBe(
        '2024-01-01',
      );
      expect('Temporal' in globalThis).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'the runtime, codecs, types and pack entries do not',
    async () => {
      const { requireTemporal } = await freshModule();
      await import('../src/exports/runtime');
      await import('../src/exports/codecs');
      await import('../src/exports/types');
      await import('../src/exports/pack');

      expect(() => requireTemporal(DECODE_A_DATE)).toThrow(UNAVAILABLE_FOR_CODEC);
    },
    timeouts.coldTransformImport,
  );
});
