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

const DECODE_A_DATE = { codecId: 'sqlite/date-temporal@1', operation: 'decode' } as const;

const UNAVAILABLE_FOR_CODEC = expect.objectContaining({
  code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
  message:
    "Codec 'sqlite/date-temporal@1' cannot decode a value because this runtime has no global Temporal implementation.",
  meta: { codecId: 'sqlite/date-temporal@1', operation: 'decode' },
});

const call = {};
const ctx = { name: 'at' };

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'Temporal');
});

afterEach(() => {
  Reflect.set(globalThis, 'Temporal', hostTemporal);
});

describe('requireTemporal', () => {
  it("returns the runtime's Temporal when the runtime has one, whatever the fallback is", async () => {
    const { setFallbackTemporal, requireTemporal } = await freshModule();
    setFallbackTemporal(otherTemporal);
    Reflect.set(globalThis, 'Temporal', hostTemporal);

    expect(requireTemporal(DECODE_A_DATE)).toBe(hostTemporal);
  });

  it('returns the fallback when the runtime has no Temporal, and sets no global', async () => {
    const { setFallbackTemporal, requireTemporal } = await freshModule();
    setFallbackTemporal(otherTemporal);

    expect(requireTemporal(DECODE_A_DATE)).toBe(otherTemporal);
    expect('Temporal' in globalThis).toBe(false);
  });

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a codec when there is no Temporal and no fallback', async () => {
    const { requireTemporal } = await freshModule();

    expect(() => requireTemporal(DECODE_A_DATE)).toThrow(UNAVAILABLE_FOR_CODEC);
  });

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a generator, saying which types need no Temporal', async () => {
    const { requireTemporal } = await freshModule();

    expect(() => requireTemporal({ generatorId: 'instantNow' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        message:
          "Mutation default generator 'instantNow' cannot produce a value because this runtime has no global Temporal implementation.",
        fix: 'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the column as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.',
        meta: { generatorId: 'instantNow' },
      }),
    );
  });
});

describe('Temporal codecs and generators with a fallback and no global Temporal', () => {
  it('decode with the fallback', async () => {
    const { setFallbackTemporal } = await freshModule();
    const codecs = await import('../src/core/date-time-codecs');
    setFallbackTemporal(otherTemporal);

    const instant = await codecs.sqliteDatetimeTemporalDescriptor
      .factory()(ctx)
      .fromWire('2024-01-01T00:00:00.000Z', call);
    const date = await codecs.sqliteDateTemporalDescriptor
      .factory()(ctx)
      .fromWire('2024-01-01', call);
    const time = await codecs.sqliteTimeTemporalDescriptor
      .factory()(ctx)
      .fromWire('12:34:56.000', call);

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

  it('the now generators read the clock of the fallback', async () => {
    const { setFallbackTemporal } = await freshModule();
    const { instantNow, plainDateNow, plainTimeNow } = await import(
      '../src/core/date-time-now-generators'
    );
    setFallbackTemporal(otherTemporal);

    expect({
      instant: instantNow() instanceof otherTemporal.Instant,
      date: plainDateNow() instanceof otherTemporal.PlainDate,
      time: plainTimeNow() instanceof otherTemporal.PlainTime,
    }).toEqual({ instant: true, date: true, time: true });
  });
});

describe('the date and time types with no global Temporal and no fallback', () => {
  it('encode a Temporal value, because encoding constructs nothing', async () => {
    await freshModule();
    const codecs = await import('../src/core/date-time-codecs');

    expect({
      instant: codecs.sqliteDatetimeTemporalEncode(
        otherTemporal.Instant.from('2024-01-01T00:00:00Z'),
      ),
      date: codecs.sqliteDateTemporalEncode(otherTemporal.PlainDate.from('2024-01-01')),
      time: codecs.sqliteTimeTemporalEncode(otherTemporal.PlainTime.from('12:34:56')),
    }).toEqual({
      instant: '2024-01-01T00:00:00.000Z',
      date: '2024-01-01',
      time: '12:34:56.000',
    });
  });

  it('decode a Temporal type with RUNTIME.TEMPORAL_UNAVAILABLE', async () => {
    await freshModule();
    const codecs = await import('../src/core/date-time-codecs');

    await expect(
      codecs.sqliteDateTemporalDescriptor.factory()(ctx).fromWire('2024-01-01', call),
    ).rejects.toThrow(UNAVAILABLE_FOR_CODEC);
  });

  it('read and write every default type, which needs no Temporal', async () => {
    await freshModule();
    const codecs = await import('../src/core/date-time-codecs');
    const { sqliteDatetimeDescriptor } = await import('../src/core/codecs');
    const datetime = sqliteDatetimeDescriptor.factory()(ctx);
    const date = codecs.sqliteDateStringDescriptor.factory()(ctx);
    const time = codecs.sqliteTimeStringDescriptor.factory()(ctx);
    const duration = codecs.sqliteDurationStringDescriptor.factory()(ctx);
    const instantText = codecs.sqliteDatetimeStringDescriptor.factory()(ctx);

    expect({
      datetime: (await datetime.fromWire(await datetime.toWire(new Date(0), call), call)).getTime(),
      instantText: await instantText.fromWire(
        await instantText.toWire('1970-01-01T00:00:00Z', call),
        call,
      ),
      date: await date.fromWire(await date.toWire('2024-02-29', call), call),
      time: await time.fromWire(await time.toWire('09:30', call), call),
      duration: await duration.fromWire(await duration.toWire('PT1H', call), call),
    }).toEqual({
      datetime: 0,
      instantText: '1970-01-01T00:00:00.000Z',
      date: '2024-02-29',
      time: '09:30:00.000',
      duration: 'PT1H',
    });
  });

  it('the Temporal now generators throw RUNTIME.TEMPORAL_UNAVAILABLE, and the string ones do not', async () => {
    await freshModule();
    const generators = await import('../src/core/date-time-now-generators');

    expect(() => generators.plainDateNow()).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        meta: { generatorId: 'plainDateNow' },
      }),
    );
    expect(typeof generators.timeStringNow()).toBe('string');
  });
});

describe('which entries set the fallback', () => {
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
    'the runtime, codecs and pack entries do not',
    async () => {
      const { requireTemporal } = await freshModule();
      await import('../src/exports/runtime');
      await import('../src/exports/codecs');
      await import('../src/exports/pack');

      expect(() => requireTemporal(DECODE_A_DATE)).toThrow(UNAVAILABLE_FOR_CODEC);
    },
    timeouts.coldTransformImport,
  );
});
