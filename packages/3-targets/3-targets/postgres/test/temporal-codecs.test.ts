/**
 * The Temporal-backed codecs, at the codec boundary.
 *
 * Every spelling fed to a decode here was taken from a real PostgreSQL server rather than written
 * from memory — see the sibling integration suite, which reads the same values back out of a
 * database and asserts the same results. The point of duplicating them as literals is that this
 * file can then cover the boundaries exhaustively and instantly, without a server per case.
 *
 * `Temporal.*.from()` is the authoritative parser and range check. So the rejection tests are not
 * asserting "our validator says no" — they are asserting that we let Temporal say no and reported
 * it usefully, which is why each one pins the error's code and the `*String` type it recommends.
 */

import { describe, expect, it } from 'vitest';
import {
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalDescriptor,
} from '../src/core/codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

const dateCodec = pgDateTemporalDescriptor.factory()(instanceCtx);
const timestampCodec = pgTimestampTemporalDescriptor.factory({})(instanceCtx);
const timestamptzCodec = pgTimestamptzTemporalDescriptor.factory({})(instanceCtx);
const timeCodec = pgTimeTemporalDescriptor.factory({})(instanceCtx);

describe('Temporal-backed temporal codecs', () => {
  describe('reads parse PostgreSQL text through Temporal', () => {
    it('decodes the ordinary spellings the server emits under ISO DateStyle', async () => {
      expect([
        (await dateCodec.decode('2026-01-02', callCtx)).toString(),
        (await timestampCodec.decode('2026-01-02 03:04:05.123456', callCtx)).toString(),
        (await timestamptzCodec.decode('2026-01-02 03:04:05.123456+00', callCtx)).toString(),
        (await timeCodec.decode('03:04:05.123456', callCtx)).toString(),
      ]).toEqual([
        '2026-01-02',
        '2026-01-02T03:04:05.123456',
        '2026-01-02T03:04:05.123456Z',
        '03:04:05.123456',
      ]);
    });

    it('reads the same instant whatever offset the session renders', async () => {
      const renderings = [
        '2026-01-02 03:04:05.123456+00',
        '2026-01-02 12:04:05.123456+09',
        '2026-01-02 08:34:05.123456+05:30',
        '2026-01-02 16:49:05.123456+13:45',
      ];

      const instants = await Promise.all(
        renderings.map(async (text) => (await timestamptzCodec.decode(text, callCtx)).toString()),
      );

      expect(instants).toEqual(Array(4).fill('2026-01-02T03:04:05.123456Z'));
    });

    it('adapts BC dates from the era spelling to the proleptic one', async () => {
      expect([
        (await dateCodec.decode('0044-03-15 BC', callCtx)).toString(),
        (await timestampCodec.decode('0044-03-15 12:00:00 BC', callCtx)).toString(),
        (await timestamptzCodec.decode('0044-03-15 12:00:00+00 BC', callCtx)).toString(),
      ]).toEqual(['-000043-03-15', '-000043-03-15T12:00:00', '-000043-03-15T12:00:00Z']);
    });

    it('adapts a BC timestamptz whose historical zone offset carries seconds', async () => {
      const decoded = await timestamptzCodec.decode('0044-03-15 21:18:59+09:18:59 BC', callCtx);

      expect(decoded.toString()).toBe('-000043-03-15T12:00:00Z');
    });

    it('adapts expanded years to the signed six-digit spelling', async () => {
      expect([
        (await dateCodec.decode('12026-01-02', callCtx)).toString(),
        (await timestampCodec.decode('12026-01-02 03:04:05', callCtx)).toString(),
        (await timestamptzCodec.decode('12026-01-02 03:04:05+00', callCtx)).toString(),
      ]).toEqual(['+012026-01-02', '+012026-01-02T03:04:05', '+012026-01-02T03:04:05Z']);
    });
  });

  describe('writes serialise through toString at full precision', () => {
    it('sends every digit it has and lets PostgreSQL do the rounding', async () => {
      expect([
        await timestamptzCodec.encode(
          Temporal.Instant.from('2026-01-02T03:04:05.123456789Z'),
          callCtx,
        ),
        await timestampCodec.encode(
          Temporal.PlainDateTime.from('2026-01-02T03:04:05.999999999'),
          callCtx,
        ),
      ]).toEqual(['2026-01-02T03:04:05.123456789Z', '2026-01-02T03:04:05.999999999']);
    });

    it('encodes the ordinary values without reformatting them', async () => {
      expect([
        await dateCodec.encode(Temporal.PlainDate.from('2026-01-02'), callCtx),
        await timeCodec.encode(Temporal.PlainTime.from('03:04:05.123456'), callCtx),
      ]).toEqual(['2026-01-02', '03:04:05.123456']);
    });
  });

  describe('values Temporal cannot represent are reported, not silently coerced', () => {
    const unrepresentable: ReadonlyArray<
      readonly [string, { decode: (w: string, c: object) => Promise<unknown> }, string, string]
    > = [
      ['date infinity', dateCodec, 'infinity', 'DateString'],
      ['date -infinity', dateCodec, '-infinity', 'DateString'],
      ['timestamp infinity', timestampCodec, 'infinity', 'TimestampString(p)'],
      ['timestamptz infinity', timestamptzCodec, 'infinity', 'TimestamptzString(p)'],
      ['timestamptz -infinity', timestamptzCodec, '-infinity', 'TimestamptzString(p)'],
      ['German DateStyle date', dateCodec, '02.01.2026', 'DateString'],
      [
        'German DateStyle timestamptz',
        timestamptzCodec,
        '02.01.2026 03:04:05.123456 UTC',
        'TimestamptzString(p)',
      ],
      ['SQL DateStyle date', dateCodec, '02/01/2026', 'DateString'],
      [
        'Postgres DateStyle timestamp',
        timestampCodec,
        'Fri 02 Jan 03:04:05.123456 2026',
        'TimestampString(p)',
      ],
      [
        'hour 24, which PostgreSQL allows and Temporal does not',
        timeCodec,
        '24:00:00',
        'TimeString(p)',
      ],
      ['a year past the end of Temporal’s range', dateCodec, '275760-09-14', 'DateString'],
    ];

    it.each(unrepresentable)(
      'rejects %s and names the string type that reads it losslessly',
      async (_label, codec, wire, stringType) => {
        await expect(codec.decode(wire, callCtx)).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          meta: { value: wire, stringType },
        });
        await expect(codec.decode(wire, callCtx)).rejects.toThrow(stringType);
      },
    );

    // Temporal rejects `infinity` on its own, so asserting only that the read fails would pass
    // whether or not the sentinel branch existed. What that branch buys is a message that explains
    // what the value *is* rather than "Cannot parse", and pinning its wording is the only thing
    // that fails when someone deletes it.
    it.each([
      ['date', dateCodec, 'infinity'],
      ['date', dateCodec, '-infinity'],
      ['timestamp', timestampCodec, 'infinity'],
      ['timestamptz', timestamptzCodec, 'infinity'],
      ['timestamptz', timestamptzCodec, '-infinity'],
    ] as const)(
      'explains that %s %s is a timeline sentinel rather than unparseable text',
      async (_kind, codec, wire) => {
        await expect(codec.decode(wire, callCtx)).rejects.toThrow(
          `PostgreSQL's ${wire} is a sentinel with no position on the timeline`,
        );
      },
    );

    it('accepts the value one day inside the range boundary it rejects one day outside', async () => {
      const inside = await dateCodec.decode('275760-09-13', callCtx);

      expect(inside.toString()).toBe('+275760-09-13');
    });
  });

  describe('calendars', () => {
    it('rejects a non-ISO calendar on write rather than discarding it', async () => {
      const hebrew = Temporal.PlainDate.from('2026-01-02').withCalendar('hebrew');

      await expect(dateCodec.encode(hebrew, callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: { codecId: PG_DATE_TEMPORAL_CODEC_ID, calendarId: 'hebrew' },
      });
    });

    it('accepts the same date in the ISO calendar', async () => {
      const iso = Temporal.PlainDate.from('2026-01-02')
        .withCalendar('hebrew')
        .withCalendar('iso8601');

      expect(await dateCodec.encode(iso, callCtx)).toBe('2026-01-02');
    });

    it('constructs ISO-calendar values on read', async () => {
      const decoded = await dateCodec.decode('2026-01-02', callCtx);

      expect(decoded.calendarId).toBe('iso8601');
    });
  });

  describe('descriptor metadata', () => {
    it.each([
      [PG_DATE_TEMPORAL_CODEC_ID, pgDateTemporalDescriptor, ['date'], 'date'],
      [
        PG_TIMESTAMP_TEMPORAL_CODEC_ID,
        pgTimestampTemporalDescriptor,
        ['timestamp'],
        'timestamp without time zone',
      ],
      [
        PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
        pgTimestamptzTemporalDescriptor,
        ['timestamptz'],
        'timestamp with time zone',
      ],
      [PG_TIME_TEMPORAL_CODEC_ID, pgTimeTemporalDescriptor, ['time'], 'time'],
    ])(
      '%s keeps the target types and native type of the column it serves',
      (id, descriptor, targetTypes, nativeType) => {
        expect({
          codecId: descriptor.codecId,
          traits: descriptor.traits,
          targetTypes: descriptor.targetTypes,
          nativeType: descriptor.nativeTypeFor({ codecId: id }),
        }).toEqual({ codecId: id, traits: ['equality', 'order'], targetTypes, nativeType });
      },
    );

    it('carries no output-type renderer, because TInput is what reaches the declaration', () => {
      expect([
        pgDateTemporalDescriptor.renderOutputType,
        pgTimestampTemporalDescriptor.renderOutputType,
        pgTimestamptzTemporalDescriptor.renderOutputType,
        pgTimeTemporalDescriptor.renderOutputType,
      ]).toEqual([undefined, undefined, undefined, undefined]);
    });
  });
});
