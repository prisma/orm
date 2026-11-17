import type { SqlStorage } from '@internal/sql-contract/types';
import {
  createContract,
  type StartupParameterRecorder,
  startStartupParameterRecorder,
  timeouts,
} from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import postgres from '../src/runtime/postgres';
import postgresServerless from '../src/runtime/postgres-serverless';

const contract = createContract<SqlStorage>();

describe('a connection the client opens from a URL', () => {
  let recorder: StartupParameterRecorder;

  beforeEach(async () => {
    recorder = await startStartupParameterRecorder();
  });

  afterEach(async () => {
    await recorder.close();
  });

  it(
    'sets DateStyle=ISO and lc_monetary=C as startup options',
    async () => {
      const db = postgres({ contract, url: recorder.url, verifyMarker: false });
      await db.execute(db.raw.sql`SELECT 1`.affectedCount().build()).catch(() => undefined);
      await db.close().catch(() => undefined);

      expect((await recorder.next())['options']).toBe('-c DateStyle=ISO -c lc_monetary=C');
    },
    timeouts.databaseOperation,
  );

  it(
    'sets DateStyle=ISO and lc_monetary=C as startup options on a serverless connection',
    async () => {
      await postgresServerless({ contract })
        .connect({ url: recorder.url })
        .catch(() => undefined);

      expect((await recorder.next())['options']).toBe('-c DateStyle=ISO -c lc_monetary=C');
    },
    timeouts.databaseOperation,
  );
});
