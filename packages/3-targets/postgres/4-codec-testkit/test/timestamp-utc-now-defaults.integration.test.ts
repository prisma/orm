import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRuntimeDriver } from './runtime-connection';

const KOLKATA_OFFSET_MILLISECONDS = (5 * 60 + 30) * 60 * 1000;
const SLACK_MILLISECONDS = 5_000;

const codecFor = (codecId: string) =>
  postgresCodecDescriptorRegistry.descriptorFor(codecId)!.factory(undefined)({
    name: 'timestamp-utc-now-defaults',
  });

const epochMillisecondsOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(Reflect.get(Object(value), 'epochMilliseconds'));

describe.each(['pg/timestamp-date@1', 'pg/timestamp-instant@1'])(
  '%s under a session whose TimeZone is Asia/Kolkata',
  (codecId) => {
    let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
    let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;
    const codec = codecFor(codecId);

    beforeAll(async () => {
      database = await createDevDatabase();
      runtime = await connectRuntimeDriver(database.connectionString);
      await runtime.connection.query("SET TimeZone = 'Asia/Kolkata'");
      await runtime.connection.query(
        'create table stamps (id int primary key, v timestamp(3) not null default now())',
      );
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await runtime?.close();
      await database?.close();
      database = undefined;
    }, timeouts.spinUpPpgDev);

    async function readBack(id: number): Promise<number> {
      const rows = await runtime!.connection.query('select v from stamps where id = $1', [id]);
      return epochMillisecondsOf(await codec.fromWire(rows[0]?.['v'], {}));
    }

    it(
      'reads the database default now(), which PostgreSQL fills in the session time zone, shifted by that zone’s offset',
      async () => {
        const before = Date.now();
        await runtime!.connection.query('insert into stamps (id) values (1)');
        const after = Date.now();

        const shift = (await readBack(1)) - after;
        expect(shift).toBeGreaterThan(
          KOLKATA_OFFSET_MILLISECONDS - (after - before) - SLACK_MILLISECONDS,
        );
        expect(shift).toBeLessThan(KOLKATA_OFFSET_MILLISECONDS + SLACK_MILLISECONDS);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reads a client now(), written through the codec as @onCreate(now()) writes it, as the same instant',
      async () => {
        const written = new Date(Date.now() - (Date.now() % 1000));
        const value =
          codecId === 'pg/timestamp-date@1'
            ? written
            : Temporal.Instant.fromEpochMilliseconds(written.getTime());
        await runtime!.connection.query('insert into stamps (id, v) values (2, $1)', [
          await codec.toWire(value, {}),
        ]);

        expect(await readBack(2)).toBe(written.getTime());
      },
      timeouts.spinUpPpgDev,
    );
  },
);
