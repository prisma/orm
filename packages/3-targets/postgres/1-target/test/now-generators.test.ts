import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dateStringNow,
  instantNow,
  plainDateNow,
  plainDateTimeNow,
  plainTimeNow,
  postgresNowGenerators,
  timeStringNow,
  timestampStringNow,
  timestamptzStringNow,
  timetzNow,
} from '../src/core/date-time-now-generators';
import {
  postgresNowGeneratorIdFor,
  postgresNowGeneratorIds,
  postgresNowGeneratorTakesPrecision,
} from '../src/core/now-generators';
import { postgresCodecRegistry } from '../src/core/registry';
import { fromContractJson, toContractJson } from './contract-json';

const generate: Readonly<Record<string, () => unknown>> = {
  [TIMESTAMP_NOW_GENERATOR_ID]: () => timestampNowRuntimeGenerator().generate(),
  ...Object.fromEntries(postgresNowGenerators.map(({ id, generate }) => [id, () => generate()])),
};

const DATE_AND_TIME_CODEC_IDS = [
  'pg/date-temporal@1',
  'pg/date-string@1',
  'pg/time-temporal@1',
  'pg/time-string@1',
  'pg/timetz@1',
  'pg/timestamp-temporal@1',
  'pg/timestamp-string@1',
  'pg/timestamptz-temporal@1',
  'pg/timestamptz-string@1',
  'pg/timestamptz-date@1',
  'pg/timestamp-date@1',
  'pg/timestamp-instant@1',
];

function codecFor(codecId: string) {
  const descriptor = postgresCodecRegistry.descriptorFor(codecId);
  if (descriptor === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return descriptor.factory({})({ name: '<test>' });
}

describe('the "now" generator for each codec', () => {
  it.each(Object.entries(postgresNowGeneratorIds))(
    'generates a value %s encodes and reads back',
    async (codecId, generatorId) => {
      const value = generate[generatorId]?.();
      const codec = codecFor(codecId);
      const wire = await codec.toWire(value, {});
      expect(typeof wire).toBe('string');
      const json = toContractJson(codec, value);
      expect(toContractJson(codec, fromContractJson(codec, json))).toEqual(json);
    },
  );

  it.each([
    'pg/date-string@1',
    'pg/time-string@1',
    'pg/timetz@1',
    'pg/timestamp-string@1',
    'pg/timestamptz-string@1',
  ])('generates a value already in the stored form of %s', (codecId) => {
    const generatorId = postgresNowGeneratorIdFor(codecId) ?? '';
    const value = generate[generatorId]?.();
    expect(toContractJson(codecFor(codecId), value)).toBe(value);
  });

  it('gives every date and time codec a generator', () => {
    expect(
      DATE_AND_TIME_CODEC_IDS.filter((codecId) => postgresNowGeneratorIdFor(codecId) === undefined),
    ).toEqual([]);
  });

  it('has no generator for a codec without one', () => {
    expect(
      ['pg/text@1', 'pg/interval@1', 'pg/interval-string@1'].map(postgresNowGeneratorIdFor),
    ).toEqual([undefined, undefined, undefined]);
  });

  it('pairs each date and time codec with its generator', () => {
    expect(postgresNowGeneratorIds).toEqual({
      'pg/date-temporal@1': 'plainDateNow',
      'pg/date-string@1': 'dateStringNow',
      'pg/time-temporal@1': 'plainTimeNow',
      'pg/time-string@1': 'timeStringNow',
      'pg/timetz@1': 'timetzNow',
      'pg/timestamp-temporal@1': 'plainDateTimeNow',
      'pg/timestamp-string@1': 'timestampStringNow',
      'pg/timestamptz-temporal@1': 'instantNow',
      'pg/timestamptz-string@1': 'timestamptzStringNow',
      'pg/timestamptz-date@1': 'timestampNow',
      'pg/timestamp-date@1': 'timestampNow',
      'pg/timestamp-instant@1': 'instantNow',
    });
  });
});

describe('the text "now" generators', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('write the stored form of the current UTC time, which reads back as written', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T03:04:05.678Z') });
    expect([
      timestampStringNow(),
      timestamptzStringNow(),
      dateStringNow(),
      timeStringNow(),
      timetzNow(),
    ]).toEqual([
      '2024-01-02T03:04:05.678',
      '2024-01-02T03:04:05.678Z',
      '2024-01-02',
      '03:04:05.678',
      '03:04:05.678Z',
    ]);
  });

  it.each([
    [0, '2024-01-02T23:59:59'],
    [1, '2024-01-02T23:59:59.9'],
    [2, '2024-01-02T23:59:59.99'],
    [6, '2024-01-02T23:59:59.999'],
  ])(
    'round the timestamp down to precision %s, so the column stores what was written',
    (precision, text) => {
      vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
      expect([timestampStringNow({ precision }), timestamptzStringNow({ precision })]).toEqual([
        text,
        `${text}Z`,
      ]);
    },
  );

  it('pass the column precision to the timestamp generators', () => {
    expect(postgresNowGeneratorTakesPrecision).toMatchObject({
      'pg/timestamp-string@1': true,
      'pg/timestamptz-string@1': true,
    });
  });

  it.each([
    ['2024-01-02T03:04:05.670Z', '2024-01-02T03:04:05.67'],
    ['2024-01-02T03:04:05.600Z', '2024-01-02T03:04:05.6'],
    ['2024-01-02T03:04:00.000Z', '2024-01-02T03:04:00'],
  ])('remove the trailing zeros of the fraction of %s', (now, text) => {
    vi.useFakeTimers({ now: new Date(now) });
    expect(timestampStringNow()).toBe(text);
  });
});

describe('the time "now" generators', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [0, '23:59:59'],
    [1, '23:59:59.9'],
    [2, '23:59:59.99'],
    [3, '23:59:59.999'],
    [6, '23:59:59.999'],
    [undefined, '23:59:59.999'],
  ])('round down to precision %s, so the column never rounds up to 24:00:00', (precision, time) => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
    const params = precision === undefined ? undefined : { precision };
    expect([timeStringNow(params), timetzNow(params), plainTimeNow(params).toString()]).toEqual([
      time,
      `${time}Z`,
      time,
    ]);
  });
});

describe('the Temporal date and time "now" generators', () => {
  const DAY_MILLISECONDS = 86_400_000;
  const utcDate = (epochMilliseconds: number) =>
    new Date(epochMilliseconds).toISOString().slice(0, 10);

  it('give the UTC date', () => {
    const before = Date.now();
    const date = plainDateNow();
    const after = Date.now();
    expect(date).toBeInstanceOf(Temporal.PlainDate);
    expect([utcDate(before), utcDate(after)]).toContain(date.toString());
  });

  it('give the UTC time of day', () => {
    const time = plainTimeNow();
    expect(time).toBeInstanceOf(Temporal.PlainTime);
    const skew = Math.abs(
      time.since(new Temporal.PlainTime()).total('millisecond') - (Date.now() % DAY_MILLISECONDS),
    );
    expect(Math.min(skew, DAY_MILLISECONDS - skew)).toBeLessThan(5_000);
  });
});

describe('the Temporal "now" generators read the clock through Date', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('follow a frozen Date even when Temporal.Now reads another clock', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z'), toFake: ['Date'] });
    const otherClock = Temporal.Instant.from('2030-06-07T08:09:10Z');
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(otherClock);
    vi.spyOn(Temporal.Now, 'plainDateTimeISO').mockReturnValue(
      otherClock.toZonedDateTimeISO('UTC').toPlainDateTime(),
    );
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      otherClock.toZonedDateTimeISO('UTC').toPlainDate(),
    );
    vi.spyOn(Temporal.Now, 'plainTimeISO').mockReturnValue(
      otherClock.toZonedDateTimeISO('UTC').toPlainTime(),
    );
    expect([
      instantNow().toString(),
      plainDateTimeNow().toString(),
      plainDateNow().toString(),
      plainTimeNow().toString(),
    ]).toEqual([
      '2024-01-02T23:59:59.999Z',
      '2024-01-02T23:59:59.999',
      '2024-01-02',
      '23:59:59.999',
    ]);
  });
});
