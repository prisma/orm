import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  instantNow,
  plainDateNow,
  plainTimeNow,
  sqliteNowGenerators,
  timeStringNow,
  timestamptzStringNow,
} from '../src/core/date-time-now-generators';
import { sqliteGeneratorDescriptors, sqliteNowGeneratorIds } from '../src/core/generator-functions';
import { sqliteCodecRegistry } from '../src/core/registry';
import { fromContractJson, toContractJson } from './contract-json';

const generate: Readonly<Record<string, () => unknown>> = {
  [TIMESTAMP_NOW_GENERATOR_ID]: () => timestampNowRuntimeGenerator().generate(),
  ...Object.fromEntries(sqliteNowGenerators.map(({ id, generate }) => [id, () => generate()])),
};

function codecFor(codecId: string) {
  const descriptor = sqliteCodecRegistry.descriptorFor(codecId);
  if (descriptor === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return descriptor.factory(undefined)({ name: '<test>' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the "now" generator for each codec', () => {
  it('pairs each date and time codec with its generator', () => {
    expect(sqliteNowGeneratorIds).toEqual({
      'sqlite/datetime@1': 'timestampNow',
      'sqlite/datetime-temporal@1': 'instantNow',
      'sqlite/datetime-string@1': 'timestamptzStringNow',
      'sqlite/date-string@1': 'dateStringNow',
      'sqlite/date-temporal@1': 'plainDateNow',
      'sqlite/time-string@1': 'timeStringNow',
      'sqlite/time-temporal@1': 'plainTimeNow',
    });
  });

  it('declares every generator it binds to the control plane', () => {
    expect(sqliteGeneratorDescriptors.map(({ id }) => id).sort()).toEqual(
      [...new Set(Object.values(sqliteNowGeneratorIds))].sort(),
    );
  });

  it.each(Object.entries(sqliteNowGeneratorIds))(
    'generates a value %s encodes and reads back',
    async (codecId, generatorId) => {
      const value = generate[generatorId]?.();
      const codec = codecFor(codecId);
      expect(typeof (await codec.toWire(value, {}))).toBe('string');
      const json = toContractJson(codec, value);
      expect(toContractJson(codec, fromContractJson(codec, json))).toEqual(json);
    },
  );

  it.each(['sqlite/datetime-string@1', 'sqlite/date-string@1', 'sqlite/time-string@1'])(
    'generates a value already in the stored form of %s',
    (codecId) => {
      const value =
        generate[sqliteNowGeneratorIds[codecId as keyof typeof sqliteNowGeneratorIds]]?.();
      expect(toContractJson(codecFor(codecId), value)).toBe(value);
    },
  );
});

describe('the "now" values', () => {
  it('are the UTC date and time of the clock, truncated to the millisecond', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-02-29T23:59:59.999Z'));
    expect({
      instant: instantNow().toString(),
      instantString: timestamptzStringNow(),
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
    expect({ instantString: timestamptzStringNow(), timeString: timeStringNow() }).toEqual({
      instantString: '2024-01-01T09:30:00.000Z',
      timeString: '09:30:00.000',
    });
  });
});
