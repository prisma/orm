import { describe, expect, it } from 'vitest';
import { pgByteaDescriptor, pgIntervalDescriptor } from '../src/core/codecs';

const ctx = {};
const interval = pgIntervalDescriptor.factory({})({ name: 'session-output-styles' });
const bytea = pgByteaDescriptor.factory()({ name: 'session-output-styles' });

const fields = (months: number, days: number, micros: bigint) => ({ months, days, micros });

describe('pg/interval@1 reads the text of every IntervalStyle, as PostgreSQL prints it', () => {
  it.each([
    ['postgres', '1 year 2 mons 3 days 04:05:06.5', fields(14, 3, 14_706_500_000n)],
    ['postgres', '-1 years -2 mons +3 days -04:00:00', fields(-14, 3, -14_400_000_000n)],
    ['postgres', '00:00:00', fields(0, 0, 0n)],
    [
      'postgres_verbose',
      '@ 1 year 2 mons 3 days 4 hours 5 mins 6.5 secs',
      fields(14, 3, 14_706_500_000n),
    ],
    ['postgres_verbose', '@ 1 mon -1 days', fields(1, -1, 0n)],
    ['postgres_verbose', '@ 1 year 2 mons -3 days 4 hours ago', fields(-14, 3, -14_400_000_000n)],
    ['postgres_verbose', '@ 1 day 2 hours 3 mins 4 secs ago', fields(0, -1, -7_384_000_000n)],
    ['postgres_verbose', '@ 1.5 secs ago', fields(0, 0, -1_500_000n)],
    ['postgres_verbose', '@ 0.000001 secs', fields(0, 0, 1n)],
    ['postgres_verbose', '@ 0', fields(0, 0, 0n)],
    ['sql_standard', '+1-2 +3 +4:05:06.5', fields(14, 3, 14_706_500_000n)],
    ['sql_standard', '+0-1 -1 +0:00:00', fields(1, -1, 0n)],
    ['sql_standard', '-1-2 +3 -4:00:00', fields(-14, 3, -14_400_000_000n)],
    ['sql_standard', '-1 2:03:04', fields(0, -1, -7_384_000_000n)],
    ['sql_standard', '1 0:00:00', fields(0, 1, 0n)],
    ['sql_standard', '-1-0', fields(-12, 0, 0n)],
    ['sql_standard', '-0-1', fields(-1, 0, 0n)],
    ['sql_standard', '0-10', fields(10, 0, 0n)],
    ['sql_standard', '-0:00:01.5', fields(0, 0, -1_500_000n)],
    ['sql_standard', '2:03:00', fields(0, 0, 7_380_000_000n)],
    ['sql_standard', '0', fields(0, 0, 0n)],
    ['iso_8601', 'P1Y2M3DT4H5M6.5S', fields(14, 3, 14_706_500_000n)],
    ['iso_8601', 'P-1DT-2H-3M-4S', fields(0, -1, -7_384_000_000n)],
    ['iso_8601', 'PT0S', fields(0, 0, 0n)],
  ])('%s: %s', async (_style, text, value) => {
    expect(await interval.fromWire(text, ctx)).toEqual(value);
  });

  it.each(['@ 1 fortnight', '@', '+1-2 3 +4:00:00', '1-2-3', ''])('refuses %j', async (text) => {
    await expect(interval.fromWire(text, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
  });
});

describe('pg/bytea@1 reads the text of both bytea_output settings', () => {
  it.each([
    ['hex', '\\x00ff41205c27', [0x00, 0xff, 0x41, 0x20, 0x5c, 0x27]],
    ['hex', '\\x', []],
    ['escape', "\\000\\377A \\\\'", [0x00, 0xff, 0x41, 0x20, 0x5c, 0x27]],
    ['escape', '', []],
  ])('%s: %j', async (_output, text, bytes) => {
    expect(await bytea.fromWire(text, ctx)).toEqual(Uint8Array.from(bytes));
  });

  it.each(['\\', '\\400', '\\x0', '\\12'])('refuses %j', async (text) => {
    await expect(bytea.fromWire(text, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
  });
});
