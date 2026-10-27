import { describe, expect, it } from 'vitest';
import { pgTimestampDateDescriptor } from '../src/core/date-codecs';
import { pgTimestampInstantDescriptor } from '../src/core/temporal-codecs';
import { fromContractJson, toContractJson } from './contract-json';

describe('pg/timestamp-date@1', () => {
  const codec = pgTimestampDateDescriptor.factory({})({ name: 'test' });

  it('represents pg/timestamp with the order traits', () => {
    expect({
      dataType: pgTimestampDateDescriptor.dataType,
      traits: pgTimestampDateDescriptor.traits,
    }).toEqual({ dataType: 'pg/timestamp', traits: ['equality', 'order'] });
  });

  it.each([
    ['2026-01-02 03:04:05.123456', '2026-01-02T03:04:05.123Z'],
    ['2026-01-02 03:04:05', '2026-01-02T03:04:05.000Z'],
    ['0001-01-01 00:00:00 BC', '0000-01-01T00:00:00.000Z'],
    ['0044-03-15 12:00:00 BC', '-000043-03-15T12:00:00.000Z'],
    ['4714-11-24 00:00:00 BC', '-004713-11-24T00:00:00.000Z'],
    ['12026-01-02 03:04:05', '+012026-01-02T03:04:05.000Z'],
    ['275760-09-13 00:00:00', '+275760-09-13T00:00:00.000Z'],
  ])('reads the wire text %s as UTC', async (wire, iso) => {
    expect(await codec.fromWire(wire, {})).toEqual(new Date(iso));
  });

  it.each([
    ['2026-01-02T03:04:05.123Z', '2026-01-02T03:04:05.123', '2026-01-02T03:04:05.123'],
    ['2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000', '2026-01-02T03:04:05'],
    ['-000043-03-15T12:00:00.000Z', '0044-03-15T12:00:00.000 BC', '-000043-03-15T12:00:00'],
    ['+012026-01-02T03:04:05.000Z', '12026-01-02T03:04:05.000', '+012026-01-02T03:04:05'],
  ])(
    'writes %s as its UTC wall-clock time, with no offset, on the wire and in JSON',
    async (iso, wire, json) => {
      const value = new Date(iso);
      expect({
        wire: await codec.toWire(value, {}),
        json: toContractJson(codec, value),
        fromWire: await codec.fromWire(wire, {}),
        fromJson: fromContractJson(codec, json),
      }).toEqual({ wire, json, fromWire: value, fromJson: value });
    },
  );

  it.each(['infinity', '-infinity', '275760-09-13 00:00:01'])(
    'refuses the wire text %s, which no Date holds, naming TimestampString',
    async (wire) => {
      await expect(codec.fromWire(wire, {})).rejects.toThrow(/TimestampString/);
    },
  );

  it.each(['infinity', '-infinity', '+275760-09-13T00:00:01'])(
    'refuses the stored value %s, which no Date holds, naming pg/timestamp-string@1',
    (json) => {
      expect(() => fromContractJson(codec, json)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DECODE_FAILED',
          message: expect.stringContaining('pg/timestamp-string@1'),
        }),
      );
    },
  );

  it('refuses wire text with an offset, which a timestamp column never prints', async () => {
    await expect(codec.fromWire('2026-01-02 03:04:05+00', {})).rejects.toThrow(
      'pg/timestamp-date@1',
    );
  });

  it.each([new Date(Number.NaN), new Date('-004713-11-23T23:59:59.999Z'), '2026-01-01', null])(
    'refuses %s on write',
    async (value) => {
      await expect(codec.toWire(value as Date, {})).rejects.toThrow('pg/timestamp-date@1');
      expect(() => toContractJson(codec, value as Date)).toThrow('pg/timestamp-date@1');
    },
  );
});

describe('pg/timestamp-instant@1', () => {
  const codec = pgTimestampInstantDescriptor.factory({})({ name: 'test' });

  it('represents pg/timestamp with the order traits', () => {
    expect({
      dataType: pgTimestampInstantDescriptor.dataType,
      traits: pgTimestampInstantDescriptor.traits,
    }).toEqual({ dataType: 'pg/timestamp', traits: ['equality', 'order'] });
  });

  it.each([
    ['2026-01-02 03:04:05.123456', '2026-01-02T03:04:05.123456Z'],
    ['2026-01-02 03:04:05', '2026-01-02T03:04:05Z'],
    ['0044-03-15 12:00:00 BC', '-000043-03-15T12:00:00Z'],
    ['12026-01-02 03:04:05', '+012026-01-02T03:04:05Z'],
    ['275760-09-13 00:00:00', '+275760-09-13T00:00:00Z'],
  ])('reads the wire text %s as an instant in UTC', async (wire, iso) => {
    const read = await codec.fromWire(wire, {});
    expect(read.equals(Temporal.Instant.from(iso))).toBe(true);
  });

  it.each([
    ['2026-01-02T03:04:05.123456Z', '2026-01-02T03:04:05.123456', '2026-01-02T03:04:05.123456'],
    ['2026-01-02T03:04:05Z', '2026-01-02T03:04:05', '2026-01-02T03:04:05'],
    ['-000043-03-15T12:00:00Z', '0044-03-15T12:00:00 BC', '-000043-03-15T12:00:00'],
  ])(
    'writes %s as its UTC wall-clock time, with no offset, on the wire and in JSON',
    async (iso, wire, json) => {
      const value = Temporal.Instant.from(iso);
      const read = {
        wire: await codec.toWire(value, {}),
        json: toContractJson(codec, value),
        fromWire: (await codec.fromWire(wire, {})).equals(value),
        fromJson: fromContractJson(codec, json).equals(value),
      };
      expect(read).toEqual({ wire, json, fromWire: true, fromJson: true });
    },
  );

  it.each(['infinity', '-infinity', '275760-09-13 00:00:01'])(
    'refuses the wire text %s, which no Temporal.Instant holds, naming TimestampString',
    async (wire) => {
      await expect(codec.fromWire(wire, {})).rejects.toThrow(
        expect.objectContaining({
          code: 'RUNTIME.DECODE_FAILED',
          message: expect.stringContaining('TimestampString'),
        }),
      );
    },
  );

  it.each(['infinity', '-infinity'])(
    'refuses the stored value %s, naming pg/timestamp-string@1',
    (json) => {
      expect(() => fromContractJson(codec, json)).toThrow(
        expect.objectContaining({ message: expect.stringContaining('pg/timestamp-string@1') }),
      );
    },
  );

  it('refuses the stored value +275760-09-13T00:00:01, past the last Temporal.Instant, naming TimestampString', () => {
    expect(() => fromContractJson(codec, '+275760-09-13T00:00:01')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: expect.stringContaining('TimestampString'),
      }),
    );
  });

  it.each([
    [Temporal.PlainDateTime.from('2026-01-02T03:04:05'), 'a Temporal.PlainDateTime'],
    [new Date('2026-01-02T03:04:05Z'), 'a Date'],
    ['2026-01-02T03:04:05Z', 'a string'],
  ])('refuses %s on write, naming Temporal.Instant', async (value, received) => {
    await expect(codec.toWire(value as unknown as Temporal.Instant, {})).rejects.toThrow(
      `Codec 'pg/timestamp-instant@1' encodes a Temporal.Instant, but received ${received}.`,
    );
  });
});
