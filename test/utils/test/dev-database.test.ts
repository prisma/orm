import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createDevDatabase, timeouts, withClient } from '../src/exports/index';

describe('createDevDatabase', () => {
  it(
    'keeps idle connections at least as long as the Postgres driver pool does',
    async () => {
      const database = await createDevDatabase();
      try {
        expect(database.databaseIdleTimeoutMillis).toBeGreaterThanOrEqual(30_000);
      } finally {
        await database.close();
      }
    },
    timeouts.databaseOperation,
  );

  it(
    'starts no worker thread while the database takes writes',
    async () => {
      let workersStarted = 0;
      const recordWorker = () => {
        workersStarted += 1;
      };
      process.on('worker', recordWorker);
      try {
        const database = await createDevDatabase();
        try {
          await withClient(database.connectionString, async (client) => {
            await client.query('create table payloads (body jsonb)');
            for (let i = 0; i < 10; i++) {
              await client.query('insert into payloads values ($1::jsonb)', [{ i }]);
            }
          });
          await sleep(1000);
        } finally {
          await database.close();
        }
      } finally {
        process.off('worker', recordWorker);
      }
      expect(workersStarted).toBe(0);
    },
    timeouts.spinUpPpgDev,
  );
});
