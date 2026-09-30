import { timeouts } from '@repo/test-utils';
import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostTemporal = Temporal;

type RequireTemporalModule = typeof import('../src/core/require-temporal');

async function freshModule(): Promise<RequireTemporalModule> {
  vi.resetModules();
  return import('../src/core/require-temporal');
}

const DECODE_A_DATE = { codecId: 'pg/date-temporal@1', operation: 'decode' } as const;

const UNAVAILABLE_FOR_CODEC = expect.objectContaining({
  code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
  message:
    "Codec 'pg/date-temporal@1' cannot decode a value because this runtime has no global Temporal implementation.",
  meta: { codecId: 'pg/date-temporal@1', operation: 'decode' },
});

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'Temporal');
});

afterEach(() => {
  Reflect.set(globalThis, 'Temporal', hostTemporal);
});

describe('requireTemporal', () => {
  it('the two implementations these tests use are different objects', () => {
    expect(otherTemporal).not.toBe(hostTemporal);
    expect(otherTemporal.Instant).not.toBe(hostTemporal.Instant);
  });

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

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a generator when there is no Temporal and no fallback', async () => {
    const { requireTemporal } = await freshModule();

    expect(() => requireTemporal({ generatorId: 'instantNow' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        message:
          "Mutation default generator 'instantNow' cannot produce a value because this runtime has no global Temporal implementation.",
        meta: { generatorId: 'instantNow' },
      }),
    );
  });
});

describe('Temporal codecs and generators with a fallback and no global Temporal', () => {
  it('decode with the fallback', async () => {
    const { setFallbackTemporal } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    setFallbackTemporal(otherTemporal);

    const decoded = {
      date: helpers.pgDateTemporalDecode('2024-01-01'),
      timestamp: helpers.pgTimestampTemporalDecode('2024-01-01 12:34:56'),
      timestamptz: helpers.pgTimestamptzTemporalDecode('2024-01-01T00:00:00Z'),
      time: helpers.pgTimeTemporalDecode('12:34:56'),
    };

    expect({
      date: [decoded.date instanceof otherTemporal.PlainDate, decoded.date.toString()],
      timestamp: [
        decoded.timestamp instanceof otherTemporal.PlainDateTime,
        decoded.timestamp.toString(),
      ],
      timestamptz: [
        decoded.timestamptz instanceof otherTemporal.Instant,
        decoded.timestamptz.toString(),
      ],
      time: [decoded.time instanceof otherTemporal.PlainTime, decoded.time.toString()],
    }).toEqual({
      date: [true, '2024-01-01'],
      timestamp: [true, '2024-01-01T12:34:56'],
      timestamptz: [true, '2024-01-01T00:00:00Z'],
      time: [true, '12:34:56'],
    });
  });

  it('the now generators read the clock of the fallback', async () => {
    const { setFallbackTemporal } = await freshModule();
    const { instantNow } = await import('../src/core/instant-now-generator');
    const { plainDateTimeNow } = await import('../src/core/plain-date-time-now-generator');
    setFallbackTemporal(otherTemporal);

    expect({
      instant: instantNow() instanceof otherTemporal.Instant,
      plainDateTime: plainDateTimeNow() instanceof otherTemporal.PlainDateTime,
    }).toEqual({ instant: true, plainDateTime: true });
  });

  it('encode accepts a value made by an implementation other than the one in use', async () => {
    const { setFallbackTemporal } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    setFallbackTemporal(otherTemporal);

    expect(
      helpers.pgTimestamptzTemporalEncode(hostTemporal.Instant.from('2024-01-01T00:00:00Z')),
    ).toBe('2024-01-01T00:00:00Z');
  });

  it("encode accepts a value made by the fallback while the runtime's Temporal is in use", async () => {
    const { setFallbackTemporal } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    setFallbackTemporal(otherTemporal);
    Reflect.set(globalThis, 'Temporal', hostTemporal);

    expect(helpers.pgDateTemporalEncode(otherTemporal.PlainDate.from('2024-01-01'))).toBe(
      '2024-01-01',
    );
  });
});

describe('Temporal codecs and generators with no global Temporal and no fallback', () => {
  it('encode a Temporal value, because encoding constructs nothing', async () => {
    await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');

    expect({
      date: helpers.pgDateTemporalEncode(otherTemporal.PlainDate.from('2024-01-01')),
      timestamp: helpers.pgTimestampTemporalEncode(
        otherTemporal.PlainDateTime.from('2024-01-01T12:34:56'),
      ),
      timestamptz: helpers.pgTimestamptzTemporalEncode(
        otherTemporal.Instant.from('2024-01-01T00:00:00Z'),
      ),
      time: helpers.pgTimeTemporalEncode(otherTemporal.PlainTime.from('12:34:56')),
    }).toEqual({
      date: '2024-01-01',
      timestamp: '2024-01-01T12:34:56',
      timestamptz: '2024-01-01T00:00:00Z',
      time: '12:34:56',
    });
  });

  it('encode refuses a value of the wrong type with the wrong-type error', async () => {
    await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    const notADate: unknown = otherTemporal.Instant.from('2024-01-01T00:00:00Z');

    expect(() =>
      helpers.pgDateTemporalEncode(notADate as Parameters<typeof helpers.pgDateTemporalEncode>[0]),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        message:
          "Codec 'pg/date-temporal@1' encodes a Temporal.PlainDate, but received a Temporal.Instant.",
      }),
    );
  });

  it('decode throws RUNTIME.TEMPORAL_UNAVAILABLE', async () => {
    await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');

    expect(() => helpers.pgDateTemporalDecode('2024-01-01')).toThrow(UNAVAILABLE_FOR_CODEC);
  });

  it('the now generators throw RUNTIME.TEMPORAL_UNAVAILABLE', async () => {
    await freshModule();
    const { instantNow } = await import('../src/core/instant-now-generator');
    const { plainDateTimeNow } = await import('../src/core/plain-date-time-now-generator');

    expect(() => instantNow()).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        meta: { generatorId: 'instantNow' },
      }),
    );
    expect(() => plainDateTimeNow()).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
        meta: { generatorId: 'plainDateTimeNow' },
      }),
    );
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
