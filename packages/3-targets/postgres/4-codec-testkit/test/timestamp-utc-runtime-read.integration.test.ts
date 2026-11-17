import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRuntimeDriver } from './runtime-connection';

const codecFor = (codecId: string) =>
  postgresCodecDescriptorRegistry.descriptorFor(codecId)!.factory(undefined)({
    name: 'timestamp-utc-runtime-read',
  });

describe('the timestamp codecs that read UTC, on values the runtime driver returns', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    runtime = await connectRuntimeDriver(database.connectionString);
    await runtime.connection.query('create table stamps (label text primary key, v timestamp)');
    await runtime.connection.query(`insert into stamps values
      ('ordinary', timestamp '2026-01-02 03:04:05.123456'),
      ('before Christ', timestamp '0044-03-15 12:00:00 BC'),
      ('infinity', 'infinity'),
      ('minus infinity', '-infinity'),
      ('past the last instant', timestamp '275760-09-13 12:00:00')`);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  async function wireOf(label: string): Promise<unknown> {
    await runtime!.connection.query("SET TimeZone = 'Asia/Kolkata'");
    const rows = await runtime!.connection.query('select v from stamps where label = $1', [label]);
    return rows[0]?.['v'];
  }

  it(
    'read the stored date and time as UTC under a session in another time zone',
    async () => {
      const ordinary = await wireOf('ordinary');
      const beforeChrist = await wireOf('before Christ');
      const date = codecFor('pg/timestamp-date@1');
      const instant = codecFor('pg/timestamp-instant@1');

      expect({
        date: await date.fromWire(ordinary, {}),
        dateBeforeChrist: await date.fromWire(beforeChrist, {}),
        instant: String(await instant.fromWire(ordinary, {})),
        instantBeforeChrist: String(await instant.fromWire(beforeChrist, {})),
      }).toEqual({
        date: new Date('2026-01-02T03:04:05.123Z'),
        dateBeforeChrist: new Date('-000043-03-15T12:00:00.000Z'),
        instant: '2026-01-02T03:04:05.123456Z',
        instantBeforeChrist: '-000043-03-15T12:00:00Z',
      });
    },
    timeouts.spinUpPpgDev,
  );

  it.each([
    ['infinity', 'pg/timestamp-date@1'],
    ['minus infinity', 'pg/timestamp-date@1'],
    ['past the last instant', 'pg/timestamp-date@1'],
    ['infinity', 'pg/timestamp-instant@1'],
    ['minus infinity', 'pg/timestamp-instant@1'],
    ['past the last instant', 'pg/timestamp-instant@1'],
  ])(
    'refuse the stored %s through %s, naming TimestampString',
    async (label, codecId) => {
      await expect(codecFor(codecId).fromWire(await wireOf(label), {})).rejects.toThrow(
        /TimestampString/,
      );
    },
    timeouts.spinUpPpgDev,
  );
});
