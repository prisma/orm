import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { describe, expect, it } from 'vitest';
import {
  sqliteDateStringColumn,
  sqliteDateStringDescriptor,
  sqliteDateTemporalColumn,
  sqliteDateTemporalDescriptor,
  sqliteDatetimeStringColumn,
  sqliteDatetimeStringDescriptor,
  sqliteDatetimeTemporalColumn,
  sqliteDatetimeTemporalDescriptor,
  sqliteDurationStringColumn,
  sqliteDurationStringDescriptor,
  sqliteTimeStringColumn,
  sqliteTimeStringDescriptor,
  sqliteTimeTemporalColumn,
  sqliteTimeTemporalDescriptor,
} from '../src/core/date-time-codecs';
import { fromContractJson, toContractJson } from './contract-json';

const ctx = { name: 'at' };
const call = {};

const datetimeTemporal = sqliteDatetimeTemporalDescriptor.factory()(ctx);
const datetimeString = sqliteDatetimeStringDescriptor.factory()(ctx);
const dateString = sqliteDateStringDescriptor.factory()(ctx);
const dateTemporal = sqliteDateTemporalDescriptor.factory()(ctx);
const timeString = sqliteTimeStringDescriptor.factory()(ctx);
const timeTemporal = sqliteTimeTemporalDescriptor.factory()(ctx);
const durationString = sqliteDurationStringDescriptor.factory()(ctx);

const ENCODE_FAILED = expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' });
const DECODE_FAILED = expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' });

describe('the data type each date and time codec represents', () => {
  it('is the type of the value it stores', () => {
    expect(
      [
        sqliteDatetimeTemporalDescriptor,
        sqliteDatetimeStringDescriptor,
        sqliteDateStringDescriptor,
        sqliteDateTemporalDescriptor,
        sqliteTimeStringDescriptor,
        sqliteTimeTemporalDescriptor,
        sqliteDurationStringDescriptor,
      ].map(({ codecId, dataType, traits }) => ({ codecId, dataType, traits })),
    ).toEqual([
      {
        codecId: 'sqlite/datetime-temporal@1',
        dataType: 'sqlite/datetime',
        traits: ['equality', 'order'],
      },
      {
        codecId: 'sqlite/datetime-string@1',
        dataType: 'sqlite/datetime',
        traits: ['equality', 'order'],
      },
      { codecId: 'sqlite/date-string@1', dataType: 'sqlite/date', traits: ['equality', 'order'] },
      { codecId: 'sqlite/date-temporal@1', dataType: 'sqlite/date', traits: ['equality', 'order'] },
      { codecId: 'sqlite/time-string@1', dataType: 'sqlite/time', traits: ['equality', 'order'] },
      { codecId: 'sqlite/time-temporal@1', dataType: 'sqlite/time', traits: ['equality', 'order'] },
      { codecId: 'sqlite/duration-string@1', dataType: 'sqlite/duration', traits: ['equality'] },
    ]);
  });
});

describe('a write stores the stored form', () => {
  it('converts an instant in another ISO form to UTC with three fraction digits', async () => {
    expect({
      temporal: await datetimeTemporal.toWire(
        Temporal.Instant.from('2024-01-01T05:30:00.5+05:30'),
        call,
      ),
      string: await datetimeString.toWire('2024-01-01T05:30:00.5+05:30', call),
      zeros: await datetimeString.toWire('2024-01-01T00:00:00.123000Z', call),
    }).toEqual({
      temporal: '2024-01-01T00:00:00.500Z',
      string: '2024-01-01T00:00:00.500Z',
      zeros: '2024-01-01T00:00:00.123Z',
    });
  });

  it('writes a date and a time of day in the form SQLite’s date() and strftime(%f) write', async () => {
    expect({
      date: await dateString.toWire('2024-02-29', call),
      dateTemporal: await dateTemporal.toWire(Temporal.PlainDate.from('2024-02-29'), call),
      time: await timeString.toWire('09:30', call),
      timeTemporal: await timeTemporal.toWire(Temporal.PlainTime.from('09:30:00.25'), call),
    }).toEqual({
      date: '2024-02-29',
      dateTemporal: '2024-02-29',
      time: '09:30:00.000',
      timeTemporal: '09:30:00.250',
    });
  });

  it('writes a duration as written', async () => {
    expect(await durationString.toWire('P1DT12H', call)).toBe('P1DT12H');
  });

  it.each([
    [
      'an instant',
      () => datetimeTemporal.toWire(Temporal.Instant.from('2024-01-01T00:00:00.000001Z'), call),
    ],
    ['a time of day', () => timeTemporal.toWire(Temporal.PlainTime.from('09:30:00.000001'), call)],
    ['instant text', () => datetimeString.toWire('2024-01-01T00:00:00.0001Z', call)],
    ['time text', () => timeString.toWire('09:30:00.0001', call)],
  ])('refuses %s with digits below a millisecond rather than rounding it', async (_name, write) => {
    await expect(write()).rejects.toThrow(ENCODE_FAILED);
  });

  it('says how to round a Temporal value with digits below a millisecond', async () => {
    await expect(
      datetimeTemporal.toWire(Temporal.Instant.from('2024-01-01T00:00:00.000001Z'), call),
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          "Codec 'sqlite/datetime-temporal@1' cannot write the Temporal.Instant 2024-01-01T00:00:00.000001Z. It has digits below a millisecond, and the column holds milliseconds. Round it first, as in value.round({ smallestUnit: 'millisecond', roundingMode: 'trunc' }).",
      }),
    );
  });

  it.each([
    ['an instant without an offset', () => datetimeString.toWire('2024-01-01T00:00:00', call)],
    ['a date that does not exist', () => dateString.toWire('2023-02-29', call)],
    ['a time with an offset', () => timeString.toWire('09:30:00+02:00', call)],
    ['text that is no duration', () => durationString.toWire('90 minutes', call)],
    ['a Date for a string type', () => dateString.toWire(new Date() as never, call)],
  ])('refuses %s', async (_name, write) => {
    await expect(write()).rejects.toThrow(ENCODE_FAILED);
  });

  it('refuses a Temporal value of the wrong kind, naming the string type that writes text', async () => {
    await expect(
      dateTemporal.toWire(Temporal.PlainDateTime.from('2024-02-29T00:00') as never, call),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        message:
          "Codec 'sqlite/date-temporal@1' encodes a Temporal.PlainDate, but received a Temporal.PlainDateTime.",
        meta: expect.objectContaining({ stringType: 'DateString' }),
      }),
    );
  });

  it('refuses a date in a calendar other than ISO 8601', async () => {
    await expect(
      dateTemporal.toWire(Temporal.PlainDate.from('2024-02-29').withCalendar('hebrew'), call),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: { codecId: 'sqlite/date-temporal@1', calendarId: 'hebrew' },
      }),
    );
  });

  it('writes a value made by any Temporal implementation', async () => {
    expect(await dateTemporal.toWire(otherTemporal.PlainDate.from('2024-02-29'), call)).toBe(
      '2024-02-29',
    );
  });
});

describe('a read', () => {
  it('reads an instant from everything sqlite/datetime@1 reads', async () => {
    const read = async (wire: string | number) => ({
      temporal: (await datetimeTemporal.fromWire(wire, call)).toString(),
      string: await datetimeString.fromWire(wire, call),
    });
    expect({
      stored: await read('2024-01-01T00:00:00.500Z'),
      unmarked: await read('2024-01-01 00:00:00'),
      epoch: await read(1_704_067_200_000),
    }).toEqual({
      stored: { temporal: '2024-01-01T00:00:00.5Z', string: '2024-01-01T00:00:00.500Z' },
      unmarked: { temporal: '2024-01-01T00:00:00Z', string: '2024-01-01T00:00:00.000Z' },
      epoch: { temporal: '2024-01-01T00:00:00Z', string: '2024-01-01T00:00:00.000Z' },
    });
  });

  it('reads a date, a time of day and a duration as stored', async () => {
    expect({
      date: await dateString.fromWire('2024-02-29', call),
      dateTemporal: (await dateTemporal.fromWire('2024-02-29', call)).toString(),
      time: await timeString.fromWire('09:30:00.250', call),
      timeTemporal: (await timeTemporal.fromWire('09:30:00.250', call)).toString(),
      duration: await durationString.fromWire('PT1H30M', call),
    }).toEqual({
      date: '2024-02-29',
      dateTemporal: '2024-02-29',
      time: '09:30:00.250',
      timeTemporal: '09:30:00.25',
      duration: 'PT1H30M',
    });
  });

  it.each([
    ['an instant that is not one', () => datetimeTemporal.fromWire('soon', call)],
    ['a date that is not one', () => dateString.fromWire('2024-02-30', call)],
    ['a Temporal date that is not one', () => dateTemporal.fromWire('2024-02-30', call)],
    ['a time of day that is not one', () => timeTemporal.fromWire('25:00', call)],
    ['a duration that is not one', () => durationString.fromWire('1 hour', call)],
  ])('refuses %s', async (_name, read) => {
    await expect(read()).rejects.toThrow(DECODE_FAILED);
  });
});

describe('the JSON path carries the same values as the wire path', () => {
  it('reads each Temporal type’s stored value as the value it names, and writes it back', () => {
    expect({
      instant: toContractJson(
        datetimeTemporal,
        fromContractJson(datetimeTemporal, '2024-01-01T00:00:00.500Z'),
      ),
      date: toContractJson(dateTemporal, fromContractJson(dateTemporal, '2024-02-29')),
      time: toContractJson(timeTemporal, fromContractJson(timeTemporal, '09:30:00.250')),
    }).toEqual({ instant: '2024-01-01T00:00:00.500Z', date: '2024-02-29', time: '09:30:00.250' });
  });

  it('reads each string type’s stored value as that text', () => {
    expect({
      instant: fromContractJson(datetimeString, '2024-01-01T00:00:00.500Z'),
      date: fromContractJson(dateString, '2024-02-29'),
      time: fromContractJson(timeString, '09:30:00.250'),
      duration: fromContractJson(durationString, 'PT1H30M'),
    }).toEqual({
      instant: '2024-01-01T00:00:00.500Z',
      date: '2024-02-29',
      time: '09:30:00.250',
      duration: 'PT1H30M',
    });
  });

  it('refuses a string value in a form other than the stored one', () => {
    expect(() => toContractJson(timeString, '09:30')).toThrow(DECODE_FAILED);
  });
});

describe('the column helper of each date and time codec', () => {
  it('builds a column of that codec, with no parameters', () => {
    expect(
      [
        sqliteDatetimeTemporalColumn(),
        sqliteDatetimeStringColumn(),
        sqliteDateStringColumn(),
        sqliteDateTemporalColumn(),
        sqliteTimeStringColumn(),
        sqliteTimeTemporalColumn(),
        sqliteDurationStringColumn(),
      ].map(({ codecId, typeParams }) => ({ codecId, typeParams })),
    ).toEqual([
      { codecId: 'sqlite/datetime-temporal@1', typeParams: undefined },
      { codecId: 'sqlite/datetime-string@1', typeParams: undefined },
      { codecId: 'sqlite/date-string@1', typeParams: undefined },
      { codecId: 'sqlite/date-temporal@1', typeParams: undefined },
      { codecId: 'sqlite/time-string@1', typeParams: undefined },
      { codecId: 'sqlite/time-temporal@1', typeParams: undefined },
      { codecId: 'sqlite/duration-string@1', typeParams: undefined },
    ]);
  });

  it('builds a codec that reads through the JSON projection the stored text unchanged', () => {
    const expression = { kind: 'column-ref' } as never;
    expect(
      [
        sqliteDatetimeTemporalDescriptor,
        sqliteDatetimeStringDescriptor,
        sqliteDateStringDescriptor,
        sqliteDateTemporalDescriptor,
        sqliteTimeStringDescriptor,
        sqliteTimeTemporalDescriptor,
        sqliteDurationStringDescriptor,
      ].map(
        (descriptor) =>
          descriptor.projectJson(expression, { codecId: descriptor.codecId }) === expression,
      ),
    ).toEqual([true, true, true, true, true, true, true]);
  });
});
