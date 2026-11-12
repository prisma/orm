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
  describe.each(['pooled', 'serverless'] as const)('%s', (transport) => {
    it.each(['parked', 'running'] as const)(
      'contains %s work before reuse without awaiting the callback',
      async (operation) => {
        const pool = new Pool({ connectionString, max: 1 });
        const options = { contract, verifyMarker: false as const, cursor: { batchSize: 1 } };
        const db =
          transport === 'pooled'
            ? postgres({ ...options, pg: pool })
            : await postgresServerless(options).connect({ url: connectionString });
        try {
          await db.execute(
            db.raw.sql`CREATE TEMP TABLE timeout_rows (id INT)`.affectedCount().build(),
          );
          const identity = db.raw.sql`SELECT pg_backend_pid() AS pid`
            .returnsRow({ pid: 'pg/int4@1' })
            .build();
          const before = await db.query(identity).toArray();
          let escaped: AsyncIterator<unknown> | undefined;
          const started = performance.now();
          await expect(
            db.transaction(
              async (tx) => {
                if (operation === 'parked') {
                  escaped = tx
                    .query(
                      tx.raw.sql`SELECT generate_series(1, 100) AS id`
                        .returnsRow({ id: 'pg/int4@1' })
                        .build(),
                    )
                    [Symbol.asyncIterator]();
                  expect(await escaped.next()).toEqual({ done: false, value: { id: 1 } });
                } else {
                  await tx.execute(
                    tx.raw.sql`INSERT INTO timeout_rows SELECT 1 FROM pg_sleep(0.2)`
                      .affectedCount()
                      .build(),
                  );
                }
                await new Promise<void>(() => {});
              },
              { timeout: 100 },
            ),
          ).rejects.toMatchObject({
            code: 'RUNTIME.TRANSACTION_TIMEOUT',
            details: { timeout: 100 },
          });
          if (operation === 'running')
            expect(performance.now() - started).toBeGreaterThanOrEqual(190);
          expect(await db.query(identity).toArray()).toEqual(before);
          expect(
            await db
              .query(
                db.raw.sql`SELECT id FROM timeout_rows`.returnsRow({ id: 'pg/int4@1' }).build(),
              )
              .toArray(),
          ).toEqual([]);
          if (escaped !== undefined)
            await expect(escaped.next()).rejects.toMatchObject({
              code: 'RUNTIME.TRANSACTION_CLOSED',
            });
          await expect(db.transaction(async () => 42)).resolves.toBe(42);
        } finally {
          await db.close();
          await pool.end();
        }
      },
      timeouts.databaseOperation,
    );
  });

  it(
    'disconnects after timeout rollback failure and accepts an explicit fresh driver binding',
    async () => {
      const created = vi.spyOn(postgresDriver, 'create');
      const db = await postgresServerless({ contract, verifyMarker: false }).connect({
        url: connectionString,
      });
      const driver = created.mock.results[0]?.value;
      if (driver === undefined) throw new Error('Expected created driver');
      const acquire = driver.acquireConnection.bind(driver);
      const failure = new Error('rollback transport failure');
      vi.spyOn(driver, 'acquireConnection').mockImplementation(async () => {
        const connection = await acquire();
        const begin = connection.beginTransaction.bind(connection);
        vi.spyOn(connection, 'beginTransaction').mockImplementation(async (options) => {
          const tx = await begin(options);
          vi.spyOn(tx, 'rollback').mockRejectedValue(failure);
          return tx;
        });
        return connection;
      });
      try {
        await expect(
          db.transaction(async () => new Promise<void>(() => {}), { timeout: 10 }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
          details: { rollbackError: failure },
          cause: { code: 'RUNTIME.TRANSACTION_TIMEOUT' },
        });
        expect(driver.state).toBe('closed');
        await expect(driver.acquireConnection()).rejects.toMatchObject({
          code: 'DRIVER.NOT_CONNECTED',
        });
        vi.mocked(driver.acquireConnection).mockRestore();
        await driver.connect({
          kind: 'pgClient',
          client: new Client({ connectionString }),
          ownedByDriver: true,
        });
        expect(
          await db
            .query(db.raw.sql`SELECT 42 AS value`.returnsRow({ value: 'pg/int4@1' }).build())
            .toArray(),
        ).toEqual([{ value: 42 }]);
      } finally {
        await db.close();
      }
    },
    timeouts.databaseOperation,
  );
});
