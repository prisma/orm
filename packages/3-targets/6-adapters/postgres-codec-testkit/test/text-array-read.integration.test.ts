import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { connectRuntimeDriver } from './runtime-connection';

const codec = postgresCodecDescriptorRegistry.descriptorFor('pg/text-array@1')!.factory(undefined)({
  name: 'text-array-read',
});

describe('pg/text-array@1 reads the text[] text the runtime driver returns', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    runtime = await connectRuntimeDriver(database.connectionString);
    connection = runtime.connection;
    await connection.query('CREATE TABLE text_arrays (value text[])');
    await connection.query("INSERT INTO text_arrays VALUES (ARRAY['a', 'b']), (ARRAY['c'])");
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'reads the max of a text[] column as an array, not as its text',
    async () => {
      const [row] = await connection!.query('SELECT max(value) AS value FROM text_arrays');
      expect(await codec.fromWire(row?.['value'] as never, {})).toEqual(['c']);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'refuses a multi-dimensional array, naming it',
    async () => {
      const [row] = await connection!.query("SELECT '{{a,b},{c,d}}'::text[] AS value");
      await expect(codec.fromWire(row?.['value'] as never, {})).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          'pg/text-array@1 reads a one-dimensional text[], and {{a,b},{c,d}} has more dimensions',
      });
    },
    timeouts.spinUpPpgDev,
  );
});
