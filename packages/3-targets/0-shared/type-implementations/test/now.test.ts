import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  dateStringNow,
  dateTimeStringNow,
  fractionDigitsOf,
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  instantNow,
  instantStringNow,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  plainDateNow,
  plainDateTimeNow,
  plainTimeNow,
  TIME_STRING_NOW_GENERATOR_ID,
  timeStringNow,
} from '../src/now';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the generator ids', () => {
  it('are the ids contracts store, each naming the value and no database type', () => {
    expect([
      INSTANT_NOW_GENERATOR_ID,
      PLAIN_DATE_TIME_NOW_GENERATOR_ID,
      PLAIN_DATE_NOW_GENERATOR_ID,
      PLAIN_TIME_NOW_GENERATOR_ID,
      INSTANT_STRING_NOW_GENERATOR_ID,
      DATE_STRING_NOW_GENERATOR_ID,
      TIME_STRING_NOW_GENERATOR_ID,
    ]).toEqual([
      'instantNow',
      'plainDateTimeNow',
      'plainDateNow',
      'plainTimeNow',
      'instantStringNow',
      'dateStringNow',
      'timeStringNow',
    ]);
  });
});

describe('fractionDigitsOf', () => {
  it.each([
    [{ precision: 2 }, 2],
    [{ precision: 0 }, 0],
    [{}, 6],
    [undefined, 6],
    [{ precision: '2' }, 6],
  ])('reads %j as %s fraction digits when the most is 6', (params, digits) => {
    expect(fractionDigitsOf(params, 6)).toBe(digits);
  });
});

describe('the text "now" values', () => {
  it('write the current UTC time, with no trailing zeros in a trimmed fraction', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T03:04:05.670Z') });
    expect([
      dateTimeStringNow(6, 'trimmed'),
      instantStringNow(6, 'trimmed'),
      dateStringNow(),
      timeStringNow(6, 'trimmed'),
    ]).toEqual(['2024-01-02T03:04:05.67', '2024-01-02T03:04:05.67Z', '2024-01-02', '03:04:05.67']);
  });

  it('write every fraction digit they are given in a fixed fraction', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T03:04:00.000Z') });
    expect([
      dateTimeStringNow(3, 'fixed'),
      instantStringNow(3, 'fixed'),
      timeStringNow(3, 'fixed'),
      instantStringNow(0, 'fixed'),
    ]).toEqual([
      '2024-01-02T03:04:00.000',
      '2024-01-02T03:04:00.000Z',
      '03:04:00.000',
      '2024-01-02T03:04:00Z',
    ]);
  });

  it.each([
    [0, '2024-01-02T23:59:59'],
    [1, '2024-01-02T23:59:59.9'],
    [2, '2024-01-02T23:59:59.99'],
    [3, '2024-01-02T23:59:59.999'],
    [6, '2024-01-02T23:59:59.999'],
  ])('round down to %s fraction digits', (fractionDigits, text) => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
    expect([
      dateTimeStringNow(fractionDigits, 'trimmed'),
      instantStringNow(fractionDigits, 'trimmed'),
      timeStringNow(fractionDigits, 'trimmed'),
    ]).toEqual([text, `${text}Z`, text.slice(11)]);
  });

  it.each([
    ['2024-01-02T03:04:05.670Z', '2024-01-02T03:04:05.67'],
    ['2024-01-02T03:04:05.600Z', '2024-01-02T03:04:05.6'],
    ['2024-01-02T03:04:00.000Z', '2024-01-02T03:04:00'],
  ])('remove the trailing zeros of a trimmed fraction of %s', (now, text) => {
    vi.useFakeTimers({ now: new Date(now) });
    expect(dateTimeStringNow(6, 'trimmed')).toBe(text);
  });
});

describe('the Temporal "now" values', () => {
  it.each([
    [0, '2024-01-02T23:59:59'],
    [1, '2024-01-02T23:59:59.9'],
    [2, '2024-01-02T23:59:59.99'],
    [3, '2024-01-02T23:59:59.999'],
    [4, '2024-01-02T23:59:59.999'],
    [6, '2024-01-02T23:59:59.999'],
  ])('round down to %s fraction digits', (fractionDigits, text) => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
    expect([
      instantNow(Temporal, fractionDigits).toString(),
      plainDateTimeNow(Temporal, fractionDigits).toString(),
      plainTimeNow(Temporal, fractionDigits).toString(),
    ]).toEqual([`${text}Z`, text, text.slice(11)]);
  });

  it('give the UTC date', () => {
    vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
    expect(plainDateNow(Temporal).toString()).toBe('2024-01-02');
  });

  it('construct their values with the implementation they are given', () => {
    expect({
      instant: instantNow(otherTemporal, 6) instanceof otherTemporal.Instant,
      plainDateTime: plainDateTimeNow(otherTemporal, 6) instanceof otherTemporal.PlainDateTime,
      plainDate: plainDateNow(otherTemporal) instanceof otherTemporal.PlainDate,
      plainTime: plainTimeNow(otherTemporal, 6) instanceof otherTemporal.PlainTime,
    }).toEqual({ instant: true, plainDateTime: true, plainDate: true, plainTime: true });
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
      instantNow(Temporal, 6).toString(),
      plainDateTimeNow(Temporal, 6).toString(),
      plainDateNow(Temporal).toString(),
      plainTimeNow(Temporal, 6).toString(),
    ]).toEqual([
      '2024-01-02T23:59:59.999Z',
      '2024-01-02T23:59:59.999',
      '2024-01-02',
      '23:59:59.999',
    ]);
  });

  describe('on a host outside UTC', () => {
    const previousTz = process.env['TZ'];
    beforeAll(() => {
      process.env['TZ'] = 'Etc/GMT-3';
    });
    afterAll(() => {
      if (previousTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = previousTz;
    });

    it('plainDateTimeNow is the current moment as UTC wall-clock time', () => {
      vi.useFakeTimers({ now: new Date('2024-01-02T23:59:59.999Z') });
      expect(plainDateTimeNow(Temporal, 3).toString()).toBe('2024-01-02T23:59:59.999');
    });
  });
});
