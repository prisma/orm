import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { describe, expect, it } from 'vitest';
import { mongoDescriptorById } from '../src/core/codecs';
import {
  mongoDateInstantCodec,
  mongoDateInstantStringCodec,
  mongoDateStringCodec,
  mongoDateTemporalCodec,
  mongoDurationStringCodec,
  mongoTimeStringCodec,
  mongoTimeTemporalCodec,
} from '../src/core/date-time-codecs';
import { fromContractJson, toContractJson } from './contract-json';

const call = {};

describe('mongo/date-instant@1', () => {
  it('writes a Temporal.Instant as a BSON date and reads it back', async () => {
    const wire = await mongoDateInstantCodec.toWire(
      Temporal.Instant.from('2024-01-01T09:30:00.123Z'),
      call,
    );
    const read = await mongoDateInstantCodec.fromWire(wire, call);
    expect({ wire: wire.toISOString(), read: read.toString() }).toEqual({
      wire: '2024-01-01T09:30:00.123Z',
      read: '2024-01-01T09:30:00.123Z',
    });
  });

  it('writes an Instant made by another Temporal implementation', async () => {
    const wire = await mongoDateInstantCodec.toWire(
      otherTemporal.Instant.from('2024-01-01T00:00:00Z'),
      call,
    );
    expect(wire.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('refuses digits below a millisecond rather than rounding them', async () => {
    await expect(
      mongoDateInstantCodec.toWire(Temporal.Instant.from('2024-01-01T00:00:00.0001Z'), call),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining("Codec 'mongo/date-instant@1' cannot write"),
    });
  });

  it('refuses a Temporal value of another kind, naming the codec', async () => {
    await expect(
      mongoDateInstantCodec.toWire(
        Temporal.PlainDate.from('2024-01-01') as unknown as Temporal.Instant,
        call,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Codec 'mongo/date-instant@1' encodes a Temporal.Instant, but received a Temporal.PlainDate.",
    });
  });

  it('stores the instant in a contract as the text toISOString() writes', () => {
    const json = toContractJson(
      mongoDateInstantCodec,
      Temporal.Instant.from('2024-01-01T01:00:00+01:00'),
    );
    expect({
      json,
      read: fromContractJson(mongoDateInstantCodec, json).toString(),
    }).toEqual({ json: '2024-01-01T00:00:00.000Z', read: '2024-01-01T00:00:00Z' });
  });
});

describe('mongo/date-instant-string@1', () => {
  it('writes ISO 8601 text with any UTC offset and reads the instant in UTC with three fraction digits', async () => {
    const wire = await mongoDateInstantStringCodec.toWire('2024-01-01T10:30:00.5+01:00', call);
    expect({
      wire: wire.toISOString(),
      read: await mongoDateInstantStringCodec.fromWire(wire, call),
    }).toEqual({ wire: '2024-01-01T09:30:00.500Z', read: '2024-01-01T09:30:00.500Z' });
  });

  it.each([
    ['2024-01-01T00:00:00', 'needs a UTC offset'],
    ['2024-01-01T00:00:00.0001Z', 'digits after the decimal point'],
    ['soon', 'cannot read'],
  ])('refuses %s', async (text, detail) => {
    await expect(mongoDateInstantStringCodec.toWire(text, call)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining(detail),
    });
  });

  it('stores the text in a contract in its stored form', () => {
    expect(toContractJson(mongoDateInstantStringCodec, '2024-01-01T00:00:00Z')).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });
});

describe('mongo/date-string@1', () => {
  it('writes a calendar date as a BSON date at midnight UTC and reads it back', async () => {
    const wire = await mongoDateStringCodec.toWire('2024-02-29', call);
    expect({
      wire: wire.toISOString(),
      read: await mongoDateStringCodec.fromWire(wire, call),
    }).toEqual({ wire: '2024-02-29T00:00:00.000Z', read: '2024-02-29' });
  });

  it('reads a date in a year after 9999', async () => {
    expect(await mongoDateStringCodec.fromWire(new Date('+010000-01-01T00:00:00.000Z'), call)).toBe(
      '+010000-01-01',
    );
  });

  it.each(['2024-02-30', '2024-02-29T00:00:00Z', 'tomorrow'])(
    'refuses to write %s',
    async (text) => {
      await expect(mongoDateStringCodec.toWire(text, call)).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        message: expect.stringContaining("Codec 'mongo/date-string@1' cannot write"),
      });
    },
  );

  it('refuses to read a BSON date that is not at midnight UTC, naming the codec', async () => {
    await expect(
      mongoDateStringCodec.fromWire(new Date('2024-02-29T09:30:00.000Z'), call),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining(
        "Codec 'mongo/date-string@1' cannot read 2024-02-29T09:30:00.000Z: a calendar date is stored as a BSON date at midnight UTC.",
      ),
      meta: { codecId: 'mongo/date-string@1', value: '2024-02-29T09:30:00.000Z' },
    });
  });

  it('refuses to read a value that is not a date', async () => {
    await expect(
      mongoDateStringCodec.fromWire('2024-02-29' as unknown as Date, call),
    ).rejects.toMatchObject({ code: 'RUNTIME.DECODE_FAILED' });
  });

  it('stores the date in a contract as its ISO 8601 date text and reads it back', () => {
    const json = toContractJson(mongoDateStringCodec, '2024-02-29');
    expect({ json, read: fromContractJson(mongoDateStringCodec, json) }).toEqual({
      json: '2024-02-29',
      read: '2024-02-29',
    });
  });

  it('refuses a contract value that is an instant, not a calendar date', () => {
    expect(() => fromContractJson(mongoDateStringCodec, '2024-02-29T09:30:00.000Z')).toThrow();
  });

  it('renders a contract value as the date text the application reads', () => {
    const render = mongoDescriptorById('mongo/date-string@1')?.renderValueLiteral;
    expect(render?.('2024-02-29', 'output')).toBe('"2024-02-29"');
  });
});

describe('mongo/date-temporal@1', () => {
  it('writes a Temporal.PlainDate as a BSON date at midnight UTC and reads it back', async () => {
    const wire = await mongoDateTemporalCodec.toWire(Temporal.PlainDate.from('2024-02-29'), call);
    const read = await mongoDateTemporalCodec.fromWire(wire, call);
    expect({ wire: wire.toISOString(), read: read.toString() }).toEqual({
      wire: '2024-02-29T00:00:00.000Z',
      read: '2024-02-29',
    });
  });

  it('refuses a date in a calendar other than ISO 8601', async () => {
    await expect(
      mongoDateTemporalCodec.toWire(
        Temporal.PlainDate.from('2024-02-29').withCalendar('hebrew'),
        call,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Codec 'mongo/date-temporal@1' accepts only the iso8601 calendar, but the value carries 'hebrew'.",
    });
  });

  it('refuses to read a BSON date that is not at midnight UTC', async () => {
    await expect(
      mongoDateTemporalCodec.fromWire(new Date('2024-02-29T00:00:00.001Z'), call),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'mongo/date-temporal@1', value: '2024-02-29T00:00:00.001Z' },
    });
  });

  it('stores the date in a contract as its ISO 8601 date text', () => {
    const json = toContractJson(mongoDateTemporalCodec, Temporal.PlainDate.from('2024-02-29'));
    expect({ json, read: fromContractJson(mongoDateTemporalCodec, json).toString() }).toEqual({
      json: '2024-02-29',
      read: '2024-02-29',
    });
  });
});

describe('mongo/time-string@1', () => {
  it('writes a time of day as a BSON string with three fraction digits', async () => {
    const wire = await mongoTimeStringCodec.toWire('09:30', call);
    expect({ wire, read: await mongoTimeStringCodec.fromWire(wire, call) }).toEqual({
      wire: '09:30:00.000',
      read: '09:30:00.000',
    });
  });

  it.each(['09:30:00.0001', '25:00', '09:30:00Z'])('refuses to write %s', async (text) => {
    await expect(mongoTimeStringCodec.toWire(text, call)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
  });

  it('refuses to read a string that is not a time of day', async () => {
    await expect(mongoTimeStringCodec.fromWire('noon', call)).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: expect.stringContaining("Codec 'mongo/time-string@1' cannot read"),
    });
  });
});

describe('mongo/time-temporal@1', () => {
  it('writes a Temporal.PlainTime as a BSON string and reads it back', async () => {
    const wire = await mongoTimeTemporalCodec.toWire(Temporal.PlainTime.from('09:30:00.5'), call);
    const read = await mongoTimeTemporalCodec.fromWire(wire, call);
    expect({ wire, read: read.toString() }).toEqual({
      wire: '09:30:00.500',
      read: '09:30:00.5',
    });
  });

  it('refuses digits below a millisecond', async () => {
    await expect(
      mongoTimeTemporalCodec.toWire(Temporal.PlainTime.from('09:30:00.0005'), call),
    ).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED' });
  });
});

describe('mongo/duration-string@1', () => {
  it('writes an ISO 8601 duration as a BSON string, as written', async () => {
    const wire = await mongoDurationStringCodec.toWire('PT1H30M', call);
    expect({ wire, read: await mongoDurationStringCodec.fromWire(wire, call) }).toEqual({
      wire: 'PT1H30M',
      read: 'PT1H30M',
    });
  });

  it('refuses text that is not a duration', async () => {
    await expect(mongoDurationStringCodec.toWire('90 minutes', call)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
  });
});

describe('the date and time codec descriptors', () => {
  it.each([
    ['mongo/date-instant@1', 'mongo/date', ['equality', 'order']],
    ['mongo/date-instant-string@1', 'mongo/date', ['equality', 'order']],
    ['mongo/date-string@1', 'mongo/calendar-date', ['equality', 'order']],
    ['mongo/date-temporal@1', 'mongo/calendar-date', ['equality', 'order']],
    ['mongo/time-string@1', 'mongo/time', ['equality', 'order']],
    ['mongo/time-temporal@1', 'mongo/time', ['equality', 'order']],
    ['mongo/duration-string@1', 'mongo/duration', ['equality']],
  ])('%s represents %s with traits %j', (codecId, dataType, traits) => {
    expect(mongoDescriptorById(codecId)).toMatchObject({ codecId, dataType, traits });
  });
});
