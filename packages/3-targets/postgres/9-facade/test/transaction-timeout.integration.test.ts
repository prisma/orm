import postgresDriver from '@internal/driver-postgres/runtime';
import { timeouts } from '@repo/test-utils';
import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postgres from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const connectionString = process.env['POSTGRES_TIMEOUT_TEST_URL'] ?? '';
afterEach(() => vi.restoreAllMocks());

describe.skipIf(connectionString === '')('native PostgreSQL callback deadlines', () => {
  it.each(['pooled', 'owned', 'supplied'] as const)(
    'discards a %s connection with a parked cursor and accepts a fresh binding',
    async (transport) => {
      const created = vi.spyOn(postgresDriver, 'create');
      const pool = new Pool({ connectionString, max: 1 });
      const client = new Client({ connectionString });
      const ended = vi.spyOn(client, 'end');
      const options = { contract, verifyMarker: false as const, cursor: { batchSize: 1 } };
      const db =
        transport === 'owned'
          ? await postgresServerless(options).connect({ url: connectionString })
          : postgres({ ...options, pg: transport === 'pooled' ? pool : client });
      try {
        await db.execute(
          db.raw.sql`CREATE TEMP TABLE timeout_rows (id INT)`.affectedCount().build(),
        );
        const driver = created.mock.results.at(-1)?.value;
        if (driver === undefined) throw new Error('Expected created driver');
        const identity = db.raw.sql`SELECT pg_backend_pid() AS pid`
          .returnsRow({ pid: 'pg/int4@1' })
          .build();
        const before = await db.query(identity).toArray();
        let escaped: AsyncIterator<unknown> | undefined;
        await expect(
          db.transaction(
            async (tx) => {
              await tx.execute(
                tx.raw.sql`INSERT INTO timeout_rows VALUES (1)`.affectedCount().build(),
              );
              escaped = tx
                .query(
                  tx.raw.sql`SELECT generate_series(1, 100) AS id`
                    .returnsRow({ id: 'pg/int4@1' })
                    .build(),
                )
                [Symbol.asyncIterator]();
              expect(await escaped.next()).toEqual({ done: false, value: { id: 1 } });
              await new Promise<void>(() => {});
            },
            { timeout: 100 },
          ),
        ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
        if (escaped === undefined) throw new Error('Expected parked cursor');
        await expect(escaped.next()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
        if (transport !== 'pooled') {
          expect(driver.state).toBe('closed');
          await expect(driver.acquireConnection()).rejects.toMatchObject({
            code: 'DRIVER.NOT_CONNECTED',
          });
          if (transport === 'supplied') {
            expect(ended).not.toHaveBeenCalled();
            expect((await client.query('SELECT id FROM timeout_rows')).rows).toEqual([]);
          }
          await driver.connect({
            kind: 'pgClient',
            client: new Client({ connectionString }),
            ownedByDriver: true,
          });
        }
        expect(await db.query(identity).toArray()).not.toEqual(before);
        await expect(db.transaction(async () => 42)).resolves.toBe(42);
      } finally {
        await db.close();
        await pool.end();
        if (transport === 'supplied') await client.end();
      }
    },
    timeouts.databaseOperation,
  );
});
