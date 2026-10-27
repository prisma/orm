import { afterEach, describe, expect, it } from 'vitest';
import { pgTimestampDateDescriptor } from '../src/core/date-codecs';
import { pgTimestampInstantDescriptor } from '../src/core/temporal-codecs';
import { fromContractJson, toContractJson } from './contract-json';

const dateCodec = pgTimestampDateDescriptor.factory({})({ name: 'at' });
const instantCodec = pgTimestampInstantDescriptor.factory({})({ name: 'at' });
const originalTimeZone = process.env['TZ'];

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTimeZone;
});

describe.each(['UTC', 'Asia/Kolkata', 'America/Los_Angeles'])(
  'the UTC timestamp codecs under TZ=%s',
  (timeZone) => {
    it('read and write the stored date and time as UTC, whatever the host time zone', async () => {
      process.env['TZ'] = timeZone;
      const date = new Date('2026-01-02T03:04:05.123Z');
      const instant = Temporal.Instant.from('2026-01-02T03:04:05.123456Z');
      expect({
        dateRead: (await dateCodec.fromWire('2026-01-02 03:04:05.123', {})).toISOString(),
        dateWire: await dateCodec.toWire(date, {}),
        dateJson: toContractJson(dateCodec, date),
        dateFromJson: fromContractJson(dateCodec, '2026-01-02T03:04:05.123').toISOString(),
        instantRead: String(await instantCodec.fromWire('2026-01-02 03:04:05.123456', {})),
        instantWire: await instantCodec.toWire(instant, {}),
        instantJson: toContractJson(instantCodec, instant),
        instantFromJson: String(fromContractJson(instantCodec, '2026-01-02T03:04:05.123456')),
      }).toEqual({
        dateRead: '2026-01-02T03:04:05.123Z',
        dateWire: '2026-01-02T03:04:05.123',
        dateJson: '2026-01-02T03:04:05.123',
        dateFromJson: '2026-01-02T03:04:05.123Z',
        instantRead: '2026-01-02T03:04:05.123456Z',
        instantWire: '2026-01-02T03:04:05.123456',
        instantJson: '2026-01-02T03:04:05.123456',
        instantFromJson: '2026-01-02T03:04:05.123456Z',
      });
    });
  },
);
