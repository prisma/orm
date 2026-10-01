import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ZONES = ['UTC', 'Europe/Amsterdam', 'Asia/Kolkata', 'America/St_Johns'] as const;

interface DateTimeType {
  readonly codecId: string;
  readonly type: string;
  /** Values at the edges of what the type holds. */
  readonly values: readonly string[];
  /** A value with six digits after the decimal point, read at each precision from 0 to 6. */
  readonly precise?: string;
}

const TYPES: readonly DateTimeType[] = [
  {
    codecId: 'pg/date-string@1',
    type: 'date',
    values: [
      '2024-01-01',
      '0044-03-15 BC',
      '4713-11-24 BC',
      '0001-01-01 BC',
      '10000-01-01',
      '5874897-12-31',
      'infinity',
      '-infinity',
    ],
  },
  {
    codecId: 'pg/time-string@1',
    type: 'time',
    values: ['00:00:00', '23:59:59.999999', '24:00:00'],
    precise: '12:34:56.123456',
  },
  {
    codecId: 'pg/timetz@1',
    type: 'timetz',
    values: ['12:00:00+01:30:15', '12:00:00-15:59', '12:00:00+15:59:59', '24:00:00+00'],
    precise: '12:34:56.123456+02',
  },
  {
    codecId: 'pg/timestamp-string@1',
    type: 'timestamp',
    values: [
      '0044-03-15 12:00:00 BC',
      '4713-11-24 00:00:00 BC',
      '294276-12-31 23:59:59',
      'infinity',
      '-infinity',
    ],
    precise: '2024-01-01 12:34:56.123456',
  },
  {
    codecId: 'pg/timestamptz-string@1',
    type: 'timestamptz',
    values: [
      '1800-01-01 00:00:00+00',
      '0044-03-15 12:00:00+00 BC',
      '294276-12-31 23:59:59+00',
      'infinity',
      '-infinity',
    ],
    precise: '2024-01-01 12:34:56.123456+00',
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

function typesAtEachPrecision(entry: DateTimeType): readonly (readonly [string, string])[] {
  const edges = entry.values.map((value) => [entry.type, value] as const);
  if (entry.precise === undefined) return edges;
  const precise = entry.precise;
  return [
    ...edges,
    ...[0, 1, 2, 3, 4, 5, 6].map((precision) => [`${entry.type}(${precision})`, precise] as const),
  ];
}

describe('the date and time codecs that carry PostgreSQL text', { concurrent: false }, () => {
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
    'read the text and the JSON PostgreSQL writes for each value, in each time zone and at each precision, unchanged',
    async () => {
      const unread: unknown[] = [];
      let read = 0;
      for (const zone of ZONES) {
        await driver!.query(`SET TimeZone = '${zone}'`);
        for (const entry of TYPES) {
          const codec = codecFor(entry.codecId);
          for (const [type, value] of typesAtEachPrecision(entry)) {
            const result = await driver!.query<{ text: string; json: string }>(
              `select $1::${type}::text as text, to_json($1::${type}) as json`,
              [value],
            );
            const row = result.rows[0]!;
            for (const form of [row.text, row.json]) {
              try {
                if (codec.decodeJson(form) === form) {
                  read += 1;
                  continue;
                }
                unread.push({ zone, type, value, form, decoded: codec.decodeJson(form) });
              } catch (error) {
                unread.push({ zone, type, value, form, error: String(error) });
              }
            }
          }
        }
      }
      await driver!.query('RESET TimeZone');
      expect({ unread, read }).toEqual({ unread: [], read: 424 });
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
        let decodeJson = 'read';
        try {
          codecFor(codecId).decodeJson(text);
        } catch {
          decodeJson = 'refused';
        }
        results.push({ type, text, postgres, decodeJson });
      }
      expect(results).toEqual(
        REFUSED.map(([, type, text]) => ({
          type,
          text,
          postgres: 'refused',
          decodeJson: 'refused',
        })),
      );
    },
    timeouts.databaseOperation,
  );
});
