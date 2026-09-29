import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostTemporal = Temporal;

type TemporalImplementationModule = typeof import('../src/core/temporal-implementation');

async function freshModule(): Promise<TemporalImplementationModule> {
  vi.resetModules();
  return import('../src/core/temporal-implementation');
}

function structuredFields(error: unknown): { code: unknown; message: unknown; meta: unknown } {
  return {
    code: Reflect.get(Object(error), 'code'),
    message: Reflect.get(Object(error), 'message'),
    meta: Reflect.get(Object(error), 'meta'),
  };
}

function thrownBy(body: () => unknown): unknown {
  try {
    body();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('temporalImplementation', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'Temporal');
  });

  afterEach(() => {
    Reflect.set(globalThis, 'Temporal', hostTemporal);
  });

  it('the two implementations these tests use are different objects', () => {
    expect(otherTemporal).not.toBe(hostTemporal);
    expect(otherTemporal.Instant).not.toBe(hostTemporal.Instant);
  });

  it("returns the runtime's Temporal when the runtime has one, whatever is registered", async () => {
    const { registerTemporalImplementation, temporalImplementation } = await freshModule();
    registerTemporalImplementation(otherTemporal);
    Reflect.set(globalThis, 'Temporal', hostTemporal);

    expect(temporalImplementation({ codecId: 'pg/date-temporal@1', operation: 'decode' })).toBe(
      hostTemporal,
    );
  });

  it('returns the registered implementation when the runtime has none, and sets no global', async () => {
    const { registerTemporalImplementation, temporalImplementation } = await freshModule();
    registerTemporalImplementation(otherTemporal);

    expect(temporalImplementation({ codecId: 'pg/date-temporal@1', operation: 'decode' })).toBe(
      otherTemporal,
    );
    expect('Temporal' in globalThis).toBe(false);
  });

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a codec when the runtime has none and none is registered', async () => {
    const { temporalImplementation } = await freshModule();

    const error = thrownBy(() =>
      temporalImplementation({ codecId: 'pg/date-temporal@1', operation: 'decode' }),
    );

    expect(structuredFields(error)).toEqual({
      code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      message:
        "Codec 'pg/date-temporal@1' cannot decode a value because this runtime has no global Temporal implementation.",
      meta: { codecId: 'pg/date-temporal@1', operation: 'decode' },
    });
  });

  it('throws RUNTIME.TEMPORAL_UNAVAILABLE for a generator when the runtime has none and none is registered', async () => {
    const { temporalImplementation } = await freshModule();

    const error = thrownBy(() => temporalImplementation({ generatorId: 'instantNow' }));

    expect(structuredFields(error)).toEqual({
      code: 'RUNTIME.TEMPORAL_UNAVAILABLE',
      message:
        "Mutation default generator 'instantNow' cannot produce a value because this runtime has no global Temporal implementation.",
      meta: { generatorId: 'instantNow' },
    });
  });
});

describe('Temporal codecs and generators with a registered implementation and no global', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'Temporal');
  });

  afterEach(() => {
    Reflect.set(globalThis, 'Temporal', hostTemporal);
  });

  it('decode with the registered implementation', async () => {
    const { registerTemporalImplementation } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    registerTemporalImplementation(otherTemporal);

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

  it('the now generators read the clock of the registered implementation', async () => {
    const { registerTemporalImplementation } = await freshModule();
    const { instantNow } = await import('../src/core/instant-now-generator');
    const { plainDateTimeNow } = await import('../src/core/plain-date-time-now-generator');
    registerTemporalImplementation(otherTemporal);

    expect({
      instant: instantNow() instanceof otherTemporal.Instant,
      plainDateTime: plainDateTimeNow() instanceof otherTemporal.PlainDateTime,
    }).toEqual({ instant: true, plainDateTime: true });
  });

  it('encode accepts a value made by an implementation other than the one in use', async () => {
    const { registerTemporalImplementation } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    registerTemporalImplementation(otherTemporal);

    expect(
      helpers.pgTimestamptzTemporalEncode(hostTemporal.Instant.from('2024-01-01T00:00:00Z')),
    ).toBe('2024-01-01T00:00:00Z');
  });

  it("encode accepts a value made by the registered implementation while the runtime's is in use", async () => {
    const { registerTemporalImplementation } = await freshModule();
    const helpers = await import('../src/core/temporal-codec-helpers');
    registerTemporalImplementation(otherTemporal);
    Reflect.set(globalThis, 'Temporal', hostTemporal);

    expect(helpers.pgDateTemporalEncode(otherTemporal.PlainDate.from('2024-01-01'))).toBe(
      '2024-01-01',
    );
  });
});

describe('which entries register an implementation', () => {
  const use = { codecId: 'pg/date-temporal@1', operation: 'decode' } as const;

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'Temporal');
  });

  afterEach(() => {
    Reflect.set(globalThis, 'Temporal', hostTemporal);
  });

  it('the control entry registers one and sets no global', async () => {
    const { temporalImplementation } = await freshModule();
    await import('../src/exports/control');

    expect(temporalImplementation(use).PlainDate.from('2024-01-01').toString()).toBe('2024-01-01');
    expect('Temporal' in globalThis).toBe(false);
  });

  it('the runtime, codecs and pack entries register none', async () => {
    const { temporalImplementation } = await freshModule();
    await import('../src/exports/runtime');
    await import('../src/exports/codecs');
    await import('../src/exports/pack');

    expect(structuredFields(thrownBy(() => temporalImplementation(use))).code).toBe(
      'RUNTIME.TEMPORAL_UNAVAILABLE',
    );
  });
});
