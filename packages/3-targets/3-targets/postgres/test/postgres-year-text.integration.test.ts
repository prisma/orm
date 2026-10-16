import type { Codec, DataType } from '@internal/framework-components/codec';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { pgDate, pgTimestamp, pgTimestamptz } from '../src/core/data-types';
import { pgTimestamptzDateDescriptor } from '../src/core/date-codecs';
import {
  pgDateTemporalDescriptor,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalDescriptor,
} from '../src/core/temporal-codecs';
import {
  pgDateStringDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';

const instanceCtx = { name: 'year-text' };
const callCtx = {};

const dates = [
  '-004713-11-24',
  '-000043-03-15',
  '0000-01-01',
  '0001-01-01',
  '9999-12-31',
  '+010000-01-01',
  '+275760-09-13',
];

interface YearType {
  readonly type: DataType;
  readonly sqlType: string;
  readonly stored: (date: string) => string;
  readonly codecs: readonly Codec[];
}

const yearTypes: readonly YearType[] = [
  {
    type: pgDate,
    sqlType: 'date',
    stored: (date) => date,
    codecs: [
      pgDateStringDescriptor.factory()(instanceCtx),
      pgDateTemporalDescriptor.factory()(instanceCtx),
    ],
  },
  {
    type: pgTimestamp,
    sqlType: 'timestamp',
    stored: (date) => `${date}T00:00:00`,
    codecs: [
      pgTimestampStringDescriptor.factory({})(instanceCtx),
      pgTimestampTemporalDescriptor.factory({})(instanceCtx),
    ],
  },
  {
    type: pgTimestamptz,
    sqlType: 'timestamptz',
    stored: (date) => `${date}T00:00:00Z`,
    codecs: [
      pgTimestamptzStringDescriptor.factory({})(instanceCtx),
      pgTimestamptzTemporalDescriptor.factory({})(instanceCtx),
      pgTimestamptzDateDescriptor.factory({})(instanceCtx),
    ],
  },
];

describe("PostgreSQL's year text against Postgres", () => {
  it(
    'writes every date of every type with every codec as text Postgres accepts, and reads back the value it wrote',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await client.query("SET TIME ZONE 'UTC'");
          const readBack: Record<string, string> = {};
          const expected: Record<string, string> = {};
          for (const { type, sqlType, stored, codecs } of yearTypes) {
            await client.query(`CREATE TABLE year_${sqlType} (k text PRIMARY KEY, v ${sqlType})`);
            for (const codec of codecs) {
              for (const date of dates) {
                const value = stored(date);
                const key = `${codec.id} ${value}`;
                expected[key] = value;
                try {
                  const wire = await codec.toWire(
                    codec.fromDataTypeValue(type.fromContract(value, {})),
                    callCtx,
                  );
                  await client.query(`INSERT INTO year_${sqlType} (k, v) VALUES ($1, $2)`, [
                    key,
                    wire,
                  ]);
                  const result = await client.query<{ printed: string }>(
                    `SELECT v::text AS printed FROM year_${sqlType} WHERE k = $1`,
                    [key],
                  );
                  const printed = result.rows[0]?.printed ?? '';
                  readBack[key] = type.toContract(
                    codec.toDataTypeValue(await codec.fromWire(printed, callCtx)),
                  ) as string;
                } catch (error) {
                  readBack[key] = error instanceof Error ? error.message : String(error);
                }
              }
            }
          }
          expect(readBack).toEqual(expected);
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
