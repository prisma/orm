import { describe, expect, it } from 'vitest';
import { codecDescriptors, mysqlDatetimeDescriptor } from '../src/core/codecs';
import { mysqlDatetime, mysqlTimestamp } from '../src/core/data-types';
import {
  mysqlDateStringDescriptor,
  mysqlDateTemporalDescriptor,
  mysqlDatetimeStringDescriptor,
  mysqlDatetimeTemporalDescriptor,
  mysqlDurationStringDescriptor,
  mysqlTimeStringDescriptor,
  mysqlTimestampDateDescriptor,
  mysqlTimestampStringDescriptor,
  mysqlTimestampTemporalDescriptor,
  mysqlTimeTemporalDescriptor,
} from '../src/core/date-time-codecs';

const ctx = {};
const instance = { name: 'test' };

const ENCODE_FAILED = expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' });
const DECODE_FAILED = expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' });

describe('the MySQL date and time codecs', () => {
  it('register every codec once, each with the data type it reads', () => {
    expect(
      codecDescriptors
        .filter((descriptor) => /date|time|duration/.test(descriptor.codecId))
        .map(({ codecId, dataType }) => [codecId, dataType]),
    ).toEqual([
      ['mysql/datetime@1', 'mysql/datetime'],
      ['mysql/datetime-temporal@1', 'mysql/datetime'],
      ['mysql/datetime-string@1', 'mysql/datetime'],
      ['mysql/timestamp-date@1', 'mysql/timestamp'],
      ['mysql/timestamp-temporal@1', 'mysql/timestamp'],
      ['mysql/timestamp-string@1', 'mysql/timestamp'],
      ['mysql/date-string@1', 'mysql/date'],
      ['mysql/date-temporal@1', 'mysql/date'],
      ['mysql/time-string@1', 'mysql/time'],
      ['mysql/time-temporal@1', 'mysql/time'],
      ['mysql/duration-string@1', 'mysql/duration'],
    ]);
  });

  it('refuse a Date outside the years a datetime holds', async () => {
    const codec = mysqlDatetimeDescriptor.factory({ precision: 3 })(instance);
    await expect(codec.toWire(new Date('0999-12-31T00:00:00Z'), ctx)).rejects.toThrow(
      /from 1000-01-01T00:00:00 to 9999-12-31T23:59:59.999999/,
    );
  });

  describe('TimestampJsDate', () => {
    const codec = mysqlTimestampDateDescriptor.factory({ precision: 3 })(instance);

    it('reads and writes a Date in UTC', async () => {
      const instant = new Date('2024-01-02T03:04:05.678Z');
      expect(await codec.fromWire('2024-01-02 03:04:05.678', ctx)).toEqual(instant);
      expect(await codec.toWire(instant, ctx)).toBe('2024-01-02 03:04:05.678');
      expect(codec.toDataTypeValue(instant)).toEqual(
        mysqlTimestamp.valueFrom('2024-01-02T03:04:05.678', { precision: 3 }),
      );
    });

    it('refuses a Date before 1970 or after 2038, which a timestamp does not hold', async () => {
      await expect(codec.toWire(new Date('1969-12-31T23:59:59Z'), ctx)).rejects.toThrow(
        ENCODE_FAILED,
      );
      await expect(codec.toWire(new Date('2038-01-19T03:14:08Z'), ctx)).rejects.toThrow(
        /from 1970-01-01T00:00:01 to 2038-01-19T03:14:07.999999/,
      );
    });
  });

  describe.each([
    ['DatetimeTemporal', mysqlDatetimeTemporalDescriptor, mysqlDatetime],
    ['TimestampTemporal', mysqlTimestampTemporalDescriptor, mysqlTimestamp],
  ] as const)('%s', (_name, descriptor, dataType) => {
    const codec = descriptor.factory({ precision: 6 })(instance);

    it('reads a row as the Temporal.Instant it names in UTC', async () => {
      const read = await codec.fromWire('2024-01-02 03:04:05.678912', ctx);
      expect(read).toBeInstanceOf(Temporal.Instant);
      expect(String(read)).toBe('2024-01-02T03:04:05.678912Z');
    });

    it('writes an instant with any offset as its UTC date and time', async () => {
      expect(await codec.toWire(Temporal.Instant.from('2024-01-02T08:34:05.5+05:30'), ctx)).toBe(
        '2024-01-02 03:04:05.5',
      );
    });

    it('refuses digits below a microsecond, a value of another type, and an instant outside the column', async () => {
      await expect(
        codec.toWire(Temporal.Instant.from('2024-01-02T03:04:05.123456789Z'), ctx),
      ).rejects.toThrow(/below a microsecond/);
      await expect(
        codec.toWire(Temporal.PlainDate.from('2024-01-02') as never, ctx),
      ).rejects.toThrow(ENCODE_FAILED);
      await expect(
        codec.toWire(Temporal.Instant.from('0999-01-01T00:00:00Z'), ctx),
      ).rejects.toThrow(ENCODE_FAILED);
    });

    it('converts a stored value to the instant and back', () => {
      const stored = dataType.valueFrom('2024-01-02T03:04:05.5', { precision: 6 });
      const instant = codec.fromDataTypeValue(stored);
      expect(String(instant)).toBe('2024-01-02T03:04:05.5Z');
      expect(codec.toDataTypeValue(instant)).toEqual(stored);
    });

    it('refuses text that names no date and time', async () => {
      await expect(codec.fromWire('0000-00-00 00:00:00', ctx)).rejects.toThrow(DECODE_FAILED);
    });
  });

  describe.each([
    ['DatetimeString', mysqlDatetimeStringDescriptor, mysqlDatetime],
    ['TimestampString', mysqlTimestampStringDescriptor, mysqlTimestamp],
  ] as const)('%s', (_name, descriptor, dataType) => {
    const codec = descriptor.factory({ precision: 6 })(instance);

    it('reads a row as the ISO instant in UTC, its fraction trimmed of trailing zeros', async () => {
      expect([
        await codec.fromWire('2024-01-02 03:04:05.500000', ctx),
        await codec.fromWire('2024-01-02 03:04:05', ctx),
      ]).toEqual(['2024-01-02T03:04:05.5Z', '2024-01-02T03:04:05Z']);
    });

    it('writes ISO text with any UTC offset as its UTC date and time', async () => {
      expect(await codec.toWire('2024-01-02T08:34:05.25+05:30', ctx)).toBe(
        '2024-01-02 03:04:05.25',
      );
    });

    it('refuses text without an offset, which names no instant, and text that is not a string', async () => {
      await expect(codec.toWire('2024-01-02T03:04:05', ctx)).rejects.toThrow(/needs a UTC offset/);
      await expect(codec.toWire(42 as never, ctx)).rejects.toThrow(ENCODE_FAILED);
    });

    it('converts a stored value to the instant text and back', () => {
      const stored = dataType.valueFrom('2024-01-02T03:04:05.5', { precision: 6 });
      expect(codec.fromDataTypeValue(stored)).toBe('2024-01-02T03:04:05.5Z');
      expect(codec.toDataTypeValue('2024-01-02T03:04:05.5Z')).toEqual(stored);
    });
  });

  describe('DateString and DateTemporal', () => {
    const text = mysqlDateStringDescriptor.factory()(instance);
    const temporal = mysqlDateTemporalDescriptor.factory()(instance);

    it('read and write a calendar date', async () => {
      expect(await text.fromWire('2024-02-29', ctx)).toBe('2024-02-29');
      expect(await text.toWire('2024-02-29', ctx)).toBe('2024-02-29');
      const day = await temporal.fromWire('2024-02-29', ctx);
      expect(day).toBeInstanceOf(Temporal.PlainDate);
      expect(String(day)).toBe('2024-02-29');
      expect(await temporal.toWire(Temporal.PlainDate.from('2024-03-01'), ctx)).toBe('2024-03-01');
    });

    it('refuse a date outside the years MySQL holds, and text with a time', async () => {
      await expect(text.toWire('0999-12-31', ctx)).rejects.toThrow(ENCODE_FAILED);
      await expect(text.toWire('2024-02-29T00:00:00', ctx)).rejects.toThrow(ENCODE_FAILED);
      await expect(temporal.toWire(Temporal.PlainDate.from('0999-12-31'), ctx)).rejects.toThrow(
        ENCODE_FAILED,
      );
      await expect(text.fromWire('0000-00-00', ctx)).rejects.toThrow(DECODE_FAILED);
    });
  });

  describe('TimeString and TimeTemporal', () => {
    const text = mysqlTimeStringDescriptor.factory({ precision: 6 })(instance);
    const temporal = mysqlTimeTemporalDescriptor.factory({ precision: 6 })(instance);

    it('read a time of day with its fraction trimmed, and write it', async () => {
      expect(await text.fromWire('09:30:00.500000', ctx)).toBe('09:30:00.5');
      expect(await text.toWire('09:30', ctx)).toBe('09:30:00');
      const clock = await temporal.fromWire('17:45:00.250000', ctx);
      expect(clock).toBeInstanceOf(Temporal.PlainTime);
      expect(String(clock)).toBe('17:45:00.25');
      expect(await temporal.toWire(Temporal.PlainTime.from('17:45:00.25'), ctx)).toBe(
        '17:45:00.25',
      );
    });

    it('refuse a MySQL time that is no time of day, on read and on write', async () => {
      await expect(text.fromWire('-01:00:00', ctx)).rejects.toThrow(DECODE_FAILED);
      await expect(temporal.fromWire('838:59:59', ctx)).rejects.toThrow(DECODE_FAILED);
      await expect(text.toWire('24:00:00', ctx)).rejects.toThrow(ENCODE_FAILED);
      await expect(
        temporal.toWire(Temporal.PlainTime.from('09:30:00.123456789'), ctx),
      ).rejects.toThrow(/below a microsecond/);
    });
  });

  describe('DurationString', () => {
    const codec = mysqlDurationStringDescriptor.factory()(instance);

    it('reads and writes an ISO 8601 duration as written', async () => {
      expect(await codec.fromWire('PT1H30M', ctx)).toBe('PT1H30M');
      expect(await codec.toWire('P1DT12H', ctx)).toBe('P1DT12H');
    });

    it('refuses text that is no ISO 8601 duration', async () => {
      await expect(codec.toWire('90 minutes', ctx)).rejects.toThrow(ENCODE_FAILED);
      await expect(codec.fromWire('90 minutes', ctx)).rejects.toThrow(DECODE_FAILED);
    });
  });

  it('render the value each string codec reads from a stored value as a TypeScript literal', () => {
    expect([
      mysqlDatetimeStringDescriptor.renderValueLiteral('2024-01-02T03:04:05'),
      mysqlTimestampStringDescriptor.renderValueLiteral('2024-01-02T03:04:05'),
      mysqlDateStringDescriptor.renderValueLiteral('2024-02-29'),
      mysqlTimeStringDescriptor.renderValueLiteral('09:30:00'),
      mysqlDurationStringDescriptor.renderValueLiteral('PT1H'),
    ]).toEqual([
      '"2024-01-02T03:04:05Z"',
      '"2024-01-02T03:04:05Z"',
      '"2024-02-29"',
      '"09:30:00"',
      '"PT1H"',
    ]);
  });
});
