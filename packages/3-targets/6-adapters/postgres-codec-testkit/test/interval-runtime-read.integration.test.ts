import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import {
  parsePostgresListText,
  postgresCodecDescriptorRegistry,
} from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const codec = postgresCodecDescriptorRegistry.descriptorFor('pg/interval@1')!.factory(undefined)({
  name: 'interval-runtime-read',
});

describe('pg/interval@1 reads interval values the runtime driver returns', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  const driver = postgresRuntimeDriverDescriptor.create();

  beforeAll(async () => {
    database = await createDevDatabase();
    await driver.connect({ kind: 'url', url: database.connectionString });
    await driver.execute({ sql: 'create table intervals (v interval, vs interval[])' });
    await driver.execute({
      sql: `insert into intervals values (
        interval '1 year 2 months 3 days 04:05:06.5',
        array[interval '1 day 02:03:04', interval '-1 years -2 mons +3 days -04:00:00']
      )`,
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver.close();
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  async function readRow() {
    const rows: Array<{ v: string; vs: string }> = [];
    for await (const row of driver.query<{ v: string; vs: string }>({
      sql: 'select v, vs from intervals',
    })) {
      rows.push(row);
    }
    return rows[0]!;
  }

  it(
    'decodes a flat interval column',
    async () => {
      const { v } = await readRow();

      expect(await codec.fromWire(v, {})).toEqual({
        months: 14,
        days: 3,
        micros: 14_706_500_000n,
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'decodes each element of an interval array column',
    async () => {
      const { vs } = await readRow();
      const elements = parsePostgresListText(vs);

      expect(await Promise.all(elements.map((element) => codec.fromWire(element, {})))).toEqual([
        { months: 0, days: 1, micros: 7_384_000_000n },
        { months: -14, days: 3, micros: -14_400_000_000n },
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
