import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStandardCodecRegistry } from '../src/core/codecs';
import {
  instantNow,
  instantStringNow,
  mongoNowGeneratorIds,
  mongoNowGenerators,
  plainDateNow,
  plainTimeNow,
  timeStringNow,
} from '../src/core/date-time-now-generators';
import { fromContractJson, toContractJson } from './contract-json';

const generate: Readonly<Record<string, () => unknown>> = {
  timestampNow: () => new Date(),
  ...Object.fromEntries(mongoNowGenerators.map(({ id, generate }) => [id, () => generate()])),
};

function codecFor(codecId: string) {
  const codec = buildStandardCodecRegistry().get(codecId);
  if (codec === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return codec;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the "now" generator for each codec', () => {
  it('pairs each date and time codec with its generator', () => {
    expect(mongoNowGeneratorIds).toEqual({
      'mongo/date@1': 'timestampNow',
      'mongo/date-instant@1': 'instantNow',
      'mongo/date-instant-string@1': 'instantStringNow',
      'mongo/date-string@1': 'dateStringNow',
      'mongo/date-temporal@1': 'plainDateNow',
      'mongo/time-string@1': 'timeStringNow',
      'mongo/time-temporal@1': 'plainTimeNow',
    });
  });

  it.each(Object.entries(mongoNowGeneratorIds))(
    'generates a value %s encodes and reads back',
    async (codecId, generatorId) => {
      const value = generate[generatorId]?.();
      const codec = codecFor(codecId);
      const wire = await codec.toWire(value, {});
      const json = toContractJson(codec, value);
      expect({
        wire: wire instanceof Date || typeof wire === 'string',
        json: toContractJson(codec, fromContractJson(codec, json)),
      }).toEqual({ wire: true, json });
    },
  );

  it.each(['mongo/date-instant-string@1', 'mongo/time-string@1'] as const)(
    'generates a value already in the form %s reads',
    async (codecId) => {
      const value = generate[mongoNowGeneratorIds[codecId]]?.();
      const codec = codecFor(codecId);
      expect(await codec.fromWire(await codec.toWire(value, {}), {})).toBe(value);
    },
  );
});

describe('the "now" values', () => {
  it('are the UTC date and time of the clock, truncated to the millisecond', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-02-29T23:59:59.999Z'));
    expect({
      instant: instantNow().toString(),
      instantString: instantStringNow(),
      date: plainDateNow().toString(),
      time: plainTimeNow().toString(),
      timeString: timeStringNow(),
    }).toEqual({
      instant: '2024-02-29T23:59:59.999Z',
      instantString: '2024-02-29T23:59:59.999Z',
      date: '2024-02-29',
      time: '23:59:59.999',
      timeString: '23:59:59.999',
    });
  });

  it('write three fraction digits when the clock is on a whole second', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-01T09:30:00.000Z'));
    expect({ instantString: instantStringNow(), timeString: timeStringNow() }).toEqual({
      instantString: '2024-01-01T09:30:00.000Z',
      timeString: '09:30:00.000',
    });
  });
});
