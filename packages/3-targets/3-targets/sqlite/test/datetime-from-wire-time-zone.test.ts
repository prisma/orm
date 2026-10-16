import { afterEach, describe, expect, it } from 'vitest';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';

const codec = sqliteDatetimeDescriptor.factory()({ name: 'at' });
const originalTimeZone = process.env['TZ'];

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTimeZone;
});

describe('sqlite/datetime@1 reads text without an offset as UTC, as SQLite does', () => {
  it.each(['UTC', 'Asia/Kolkata'])('under TZ=%s', async (timeZone) => {
    process.env['TZ'] = timeZone;
    const read = async (wire: string) => (await codec.fromWire(wire, {})).toISOString();
    expect({
      spaced: await read('2024-01-01 00:00:00'),
      fraction: await read('2024-01-01 12:34:56.5'),
      minutes: await read('2024-01-01T12:34'),
      dateOnly: await read('2024-01-01'),
      offset: await read('2024-01-01T05:30:00+05:30'),
      stored: await read('2024-01-01T00:00:00.000Z'),
    }).toEqual({
      spaced: '2024-01-01T00:00:00.000Z',
      fraction: '2024-01-01T12:34:56.500Z',
      minutes: '2024-01-01T12:34:00.000Z',
      dateOnly: '2024-01-01T00:00:00.000Z',
      offset: '2024-01-01T00:00:00.000Z',
      stored: '2024-01-01T00:00:00.000Z',
    });
  });

  it('reads more than three fraction digits, cut to milliseconds as Date reads them', async () => {
    const read = async (wire: string) => (await codec.fromWire(wire, {})).toISOString();
    expect({
      python: await read('2024-01-01 00:00:00.123456'),
      iso: await read('2024-01-01T00:00:00.1239Z'),
    }).toEqual({ python: '2024-01-01T00:00:00.123Z', iso: '2024-01-01T00:00:00.123Z' });
  });

  it('reads what earlier Prisma versions write to a DateTime column', async () => {
    const read = async (wire: string | number) =>
      (await codec.fromWire(wire as string, {})).toISOString();
    expect({
      engineMilliseconds: await read(1704067200123),
      adapterIso: await read('2024-01-01T00:00:00.123+00:00'),
      currentTimestamp: await read('2024-01-01 00:00:00'),
    }).toEqual({
      engineMilliseconds: '2024-01-01T00:00:00.123Z',
      adapterIso: '2024-01-01T00:00:00.123Z',
      currentTimestamp: '2024-01-01T00:00:00.000Z',
    });
  });

  it('still reads text Date reads that is not ISO 8601', async () => {
    expect((await codec.fromWire('2024', {})).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('refuses text that is no date at all', async () => {
    await expect(codec.fromWire('not a date', {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
  });
});
