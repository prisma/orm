import type { SqlConnection } from '@internal/sql-relational-core/ast';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client, Pool } from 'pg';
import { expect, it } from 'vitest';
import descriptor from '../src/exports/runtime';
import { queryRows } from './sql-queryable-test-utils';

async function database() {
  const connectionString = process.env['POSTGRES_LEASE_TEST_URL'];
  if (connectionString !== undefined) return { connectionString, close: async () => undefined };
  return createDevDatabase();
}

it.each([false, true])(
  'reuses a pooled client after closing a parked cursor, explicit transaction %s',
  async (explicit) => {
    const db = await database();
    const pool = new Pool({ connectionString: db.connectionString, max: 1 });
    const driver = descriptor.create({ cursor: { batchSize: 1 } });
    let held: SqlConnection | undefined;
    try {
      await driver.connect({ kind: 'pgPool', pool, ownedByDriver: true });
      const connection = await driver.acquireConnection();
      held = connection;
      const identity = await queryRows(connection, 'SELECT pg_backend_pid() AS pid');
      const scope = explicit ? await connection.beginTransaction() : connection;
      const rows = scope
        .query({ sql: 'SELECT generate_series(1, 5) AS id' })
        [Symbol.asyncIterator]();
      expect(await rows.next()).toEqual({ done: false, value: { id: '1' } });
      if ('rollback' in scope) await scope.rollback();
      await connection.release();
      const reused = await driver.acquireConnection();
      held = reused;
      expect(await queryRows(reused, 'SELECT pg_backend_pid() AS pid')).toEqual(identity);
      await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
      expect(await queryRows(reused, 'SELECT 42 AS value')).toEqual([{ value: '42' }]);
      await reused.release();
    } finally {
      await held?.destroy();
      await driver.close();
      await db.close();
    }
  },
  timeouts.spinUpPpgDev,
);

it.each([false, true])(
  'upgrades a pending direct release while a driver cursor is parked, owned %s',
  async (ownedByDriver) => {
    const db = await database();
    const client = new Client({ connectionString: db.connectionString });
    const driver = descriptor.create({ cursor: { batchSize: 1 } });
    let held: SqlConnection | undefined;
    try {
      await driver.connect({ kind: 'pgClient', client, ownedByDriver });
      const rows = driver
        .query({ sql: 'SELECT generate_series(1, 5) AS id' })
        [Symbol.asyncIterator]();
      await rows.next();
      held = await driver.acquireConnection();
      const releasing = held.release();
      await Promise.all([releasing, held.destroy(new Error('abandoned'))]);
      expect(driver.state).toBe('closed');
      await expect(rows.next()).rejects.toMatchObject({ kind: 'sql_connection' });
    } finally {
      await held?.destroy();
      await driver.close();
      if (!ownedByDriver) await client.end();
      await db.close();
    }
  },
  timeouts.spinUpPpgDev,
);

it.each([false, true])(
  'disconnects a destroyed direct binding and accepts a fresh client, driver owned %s',
  async (ownedByDriver) => {
    const db = await database();
    const client = new Client({ connectionString: db.connectionString });
    const fresh = new Client({ connectionString: db.connectionString });
    const driver = descriptor.create({ cursor: { batchSize: 1 } });
    let held: SqlConnection | undefined;
    try {
      await driver.connect({ kind: 'pgClient', client, ownedByDriver });
      const connection = await driver.acquireConnection();
      held = connection;
      const tx = await connection.beginTransaction();
      const rows = tx.query({ sql: 'SELECT generate_series(1, 5) AS id' })[Symbol.asyncIterator]();
      await rows.next();
      await connection.destroy(new Error('abandoned'));
      expect(driver.state).toBe('closed');
      await expect(driver.acquireConnection()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
      });
      await expect(rows.next()).rejects.toMatchObject({ kind: 'sql_connection' });
      await driver.connect({ kind: 'pgClient', client: fresh, ownedByDriver: true });
      expect(await queryRows(driver, 'SELECT 42 AS value')).toEqual([{ value: '42' }]);
    } finally {
      await held?.destroy();
      await driver.close();
      await client.end().catch(() => undefined);
      await db.close();
    }
  },
  timeouts.spinUpPpgDev,
);
