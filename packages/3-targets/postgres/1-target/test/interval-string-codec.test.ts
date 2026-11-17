import { describe, expect, it } from 'vitest';
import { pgIntervalStringDescriptor } from '../src/core/interval-string-codec';
import { fromContractJson, toContractJson } from './contract-json';

const codec = pgIntervalStringDescriptor.factory({})({ name: 'test' });

describe('pg/interval-string@1', () => {
  it('represents pg/interval, keeping the form a value was written in', () => {
    expect({
      dataType: pgIntervalStringDescriptor.dataType,
      traits: pgIntervalStringDescriptor.traits,
      keepsWrittenForm: pgIntervalStringDescriptor.keepsWrittenForm,
    }).toEqual({ dataType: 'pg/interval', traits: ['equality', 'order'], keepsWrittenForm: true });
  });

  it.each([
    ['1 year 2 mons 3 days 04:05:06.5', 'P1Y2M3DT4H5M6.5S'],
    ['-1 years -2 mons +3 days -04:00:00', 'P-1Y-2M3DT-4H'],
    ['00:00:00', 'PT0S'],
    ['@ 1 year 2 mons -3 days 4 hours 5 mins 6.5 secs ago', 'P-1Y-2M3DT-4H-5M-6.5S'],
    ['+1-2 -3 +4:05:06.5', 'P1Y2M-3DT4H5M6.5S'],
    ['-1 2:03:04', 'P-1DT-2H-3M-4S'],
    ['P1Y2M3DT4H5M6.5S', 'P1Y2M3DT4H5M6.5S'],
    ['P0D', 'PT0S'],
  ])('reads the text %s, printed under any IntervalStyle, as %s', async (wire, iso) => {
    expect(await codec.fromWire(wire, {})).toBe(iso);
  });

  it('reads the fields object a driver may parse an interval into', async () => {
    expect(await codec.fromWire({ years: 1, months: 2, days: 3, hours: 4 }, {})).toBe('P1Y2M3DT4H');
  });

  it.each([
    ['P1Y2M', 'P1Y2M'],
    ['P14M', 'P1Y2M'],
    ['PT90M', 'PT1H30M'],
    ['P1DT-1H', 'P1DT-1H'],
    ['PT0.000001S', 'PT0.000001S'],
  ])('writes %s as the duration pg/interval stores, %s', async (written, stored) => {
    expect({
      wire: await codec.toWire(written, {}),
      json: toContractJson(codec, written),
      fromJson: fromContractJson(codec, stored),
    }).toEqual({ wire: stored, json: stored, fromJson: stored });
  });

  it.each([
    ['1 day', 'an ISO 8601 duration'],
    ['P', 'an ISO 8601 duration'],
    ['', 'an ISO 8601 duration'],
    ['PT1.1234567S', 'at most 6'],
  ])('refuses %s on write', async (written, reason) => {
    await expect(codec.toWire(written, {})).rejects.toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        message: expect.stringContaining(reason),
      }),
    );
    expect(() => toContractJson(codec, written)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }),
    );
  });

  it.each([42, null, { months: 1, days: 0, micros: 0n }])(
    'refuses %s, which is not a string, on write',
    async (value) => {
      await expect(codec.toWire(value as unknown as string, {})).rejects.toThrow(
        expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }),
      );
    },
  );
});
