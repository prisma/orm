import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { readContractValue } from '@internal/framework-components/codec';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ZONES = ['UTC', 'Europe/Amsterdam', 'Asia/Kolkata', 'America/St_Johns'] as const;

interface DateTimeType {
  readonly codecId: string;
  readonly type: string;
  /** Values at the edges of what the type holds, each with the stored form the codec reads it as in every time zone. */
  readonly values: readonly (readonly [value: string, stored: string])[];
  /** A value with six digits after the decimal point, read at each precision from 0 to 6, and its stored form for a fraction. */
  readonly precise?: {
    readonly value: string;
    readonly stored: (fraction: string) => string;
  };
}

/** The fraction PostgreSQL keeps of .123456 at each precision from 0 to 6, without trailing zeros. */
const FRACTIONS = ['', '.1', '.12', '.123', '.1235', '.12346', '.123456'] as const;

const TYPES: readonly DateTimeType[] = [
  {
    codecId: 'pg/date-string@1',
    type: 'date',
    values: [
      ['2024-01-01', '2024-01-01'],
      ['0044-03-15 BC', '-000043-03-15'],
      ['4713-11-24 BC', '-004712-11-24'],
      ['0001-01-01 BC', '0000-01-01'],
      ['10000-01-01', '+010000-01-01'],
      ['5874897-12-31', '+5874897-12-31'],
      ['infinity', 'infinity'],
      ['-infinity', '-infinity'],
    ],
  },
  {
    codecId: 'pg/time-string@1',
    type: 'time',
    values: [
      ['00:00:00', '00:00:00'],
      ['23:59:59.999999', '23:59:59.999999'],
      ['24:00:00', '24:00:00'],
    ],
    precise: { value: '12:34:56.123456', stored: (fraction) => `12:34:56${fraction}` },
  },
  {
    codecId: 'pg/timetz@1',
    type: 'timetz',
    values: [
      ['12:00:00+01:30:15', '12:00:00+01:30:15'],
      ['12:00:00-15:59', '12:00:00-15:59'],
      ['12:00:00+15:59:59', '12:00:00+15:59:59'],
      ['24:00:00+00', '24:00:00Z'],
    ],
    precise: { value: '12:34:56.123456+02', stored: (fraction) => `12:34:56${fraction}+02:00` },
  },
  {
    codecId: 'pg/timestamp-string@1',
    type: 'timestamp',
    values: [
      ['0044-03-15 12:00:00 BC', '-000043-03-15T12:00:00'],
      ['4713-11-24 00:00:00 BC', '-004712-11-24T00:00:00'],
      ['294276-12-31 23:59:59', '+294276-12-31T23:59:59'],
      ['infinity', 'infinity'],
      ['-infinity', '-infinity'],
    ],
    precise: {
      value: '2024-01-01 12:34:56.123456',
      stored: (fraction) => `2024-01-01T12:34:56${fraction}`,
    },
  },
  {
    codecId: 'pg/timestamptz-string@1',
    type: 'timestamptz',
    values: [
      ['1800-01-01 00:00:00+00', '1800-01-01T00:00:00Z'],
      ['0044-03-15 12:00:00+00 BC', '-000043-03-15T12:00:00Z'],
      ['294276-12-31 23:59:59+00', '+294276-12-31T23:59:59Z'],
      ['infinity', 'infinity'],
      ['-infinity', '-infinity'],
    ],
    precise: {
      value: '2024-01-01 12:34:56.123456+00',
      stored: (fraction) => `2024-01-01T12:34:56${fraction}Z`,
    },
  },
];

const REFUSED: readonly (readonly [codecId: string, type: string, text: string])[] = [
  ['pg/date-string@1', 'date', 'not a date'],
  ['pg/date-string@1', 'date', '2024-02-30'],
  ['pg/time-string@1', 'time', '25:00:00'],
  ['pg/time-string@1', 'time', '24:00:00.5'],
  ['pg/timetz@1', 'timetz', '12:00:00+16'],
  ['pg/timestamp-string@1', 'timestamp', '2024-01-01 24:00:01'],
  ['pg/timestamptz-string@1', 'timestamptz', 'noon'],
];

function codecFor(codecId: string) {
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)!.factory(undefined)({
    name: 'date-time-text',
  });
}

function typesAtEachPrecision(
  entry: DateTimeType,
): readonly (readonly [type: string, value: string, stored: string])[] {
  const edges = entry.values.map(([value, stored]) => [entry.type, value, stored] as const);
  if (entry.precise === undefined) return edges;
  const { value, stored } = entry.precise;
  return [
    ...edges,
    ...FRACTIONS.map(
      (fraction, precision) => [`${entry.type}(${precision})`, value, stored(fraction)] as const,
    ),
  ];
}

describe('the date and time codecs that carry text', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'read the text PostgreSQL writes for each value, in each time zone and at each precision, as its ISO 8601 stored form',
    async () => {
      const unread: unknown[] = [];
      let read = 0;
      for (const zone of ZONES) {
        await driver!.query(`SET TimeZone = '${zone}'`);
        for (const entry of TYPES) {
          const codec = codecFor(entry.codecId);
          for (const [type, value, stored] of typesAtEachPrecision(entry)) {
            const result = await driver!.query<{ text: string }>(
              `select $1::${type}::text as text`,
              [value],
            );
            const text = result.rows[0]!.text;
            try {
              const decoded = await codec.fromWire(text, {});
              if (decoded === stored) {
                read += 1;
                continue;
              }
              unread.push({ zone, type, value, text, stored, decoded });
            } catch (error) {
              unread.push({ zone, type, value, text, error: String(error) });
            }
          }
        }
      }
      await driver!.query('RESET TimeZone');
      expect({ unread, read }).toEqual({ unread: [], read: 212 });
    },
    timeouts.databaseOperation,
  );

  it(
    'write each value they read back in a form PostgreSQL reads as the same value',
    async () => {
      const changed: unknown[] = [];
      for (const entry of TYPES) {
        const codec = codecFor(entry.codecId);
        for (const [, stored] of entry.values) {
          const wire = await codec.toWire(stored, {});
          const result = await driver!.query<{ text: string }>(
            `select $1::${entry.type}::text as text`,
            [wire],
          );
          const read = await codec.fromWire(result.rows[0]!.text, {});
          if (read !== stored) changed.push({ type: entry.type, stored, wire, read });
        }
      }
      expect(changed).toEqual([]);
    },
    timeouts.databaseOperation,
  );

  it(
    'refuse, with every codec, a date or timestamp the session prints under another DateStyle, naming the setting',
    async () => {
      const refusals = [];
      await driver!.query("SET DateStyle = 'German, DMY'");
      try {
        for (const [codecId, type] of [
          ['pg/date-string@1', 'date'],
          ['pg/date-temporal@1', 'date'],
          ['pg/timestamp-string@1', 'timestamp'],
          ['pg/timestamp-temporal@1', 'timestamp'],
          ['pg/timestamptz-string@1', 'timestamptz'],
          ['pg/timestamptz-temporal@1', 'timestamptz'],
          ['pg/timestamptz-date@1', 'timestamptz'],
        ] as const) {
          const result = await driver!.query<{ text: string }>(
            `select '2024-01-02 03:04:05'::${type}::text as text`,
          );
          refusals.push(
            await codecFor(codecId)
              .fromWire(result.rows[0]!.text, {})
              .then(
                () => 'read',
                (error: { code?: string }) => error.code,
              ),
          );
        }
      } finally {
        await driver!.query('RESET DateStyle');
      }
      expect(refusals).toEqual(Array(7).fill('RUNTIME.DATE_STYLE_NOT_ISO'));
    },
    timeouts.databaseOperation,
  );

  it(
    'refuse text PostgreSQL refuses for their type',
    async () => {
      const results = [];
      for (const [codecId, type, text] of REFUSED) {
        const postgres = await driver!.query(`select $1::${type}::text as text`, [text]).then(
          () => 'read',
          () => 'refused',
        );
        let readsJson = 'read';
        try {
          readContractValue(codecFor(codecId), text, undefined);
        } catch {
          readsJson = 'refused';
        }
        results.push({ type, text, postgres, readsJson });
      }
      expect(results).toEqual(
        REFUSED.map(([, type, text]) => ({
          type,
          text,
          postgres: 'refused',
          readsJson: 'refused',
        })),
      );
    },
    timeouts.databaseOperation,
  );
});
