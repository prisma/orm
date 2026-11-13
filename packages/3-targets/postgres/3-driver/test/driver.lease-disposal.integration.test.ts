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

it.skipIf(process.env['POSTGRES_LEASE_TEST_URL'] === undefined)(
  'interrupts a native blocked nonstream query when direct release is upgraded',
  async () => {
    const db = await database();
    const blocker = new Client({ connectionString: db.connectionString });
    const client = new Client({ connectionString: db.connectionString });
    const driver = descriptor.create({ cursor: { disabled: true } });
    let held: SqlConnection | undefined;
    let running: Promise<unknown> | undefined;
    let disposing: Promise<unknown> | undefined;
    await blocker.connect();
    try {
      const key = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await blocker.query('SELECT pg_advisory_lock($1)', [key]);
      await driver.connect({ kind: 'pgClient', client, ownedByDriver: true });
      held = await driver.acquireConnection();
      const identity = await queryRows<{ pid: string }>(held, 'SELECT pg_backend_pid() AS pid');
      running = held
        .execute({ sql: 'SELECT pg_advisory_lock($1)', params: [key] })
        .catch((error: unknown) => error);
      await expect
        .poll(
          async () =>
            (
              await blocker.query<{ blocked: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS blocked',
                [identity[0]!.pid],
              )
            ).rows[0]!.blocked,
        )
        .toBe(true);
      const releasing = held.release();
      let disposed = false;
      disposing = Promise.all([releasing, held.destroy(new Error('abandoned'))]).then(() => {
        disposed = true;
      });
      await expect.poll(() => disposed).toBe(true);
      expect(await running).toMatchObject({ kind: 'sql_connection' });
      expect(driver.state).toBe('closed');
    } finally {
      await blocker.query('SELECT pg_advisory_unlock_all()');
      await Promise.allSettled([running, disposing]);
      await held?.destroy();
      await driver.close();
      await blocker.end();
      await db.close();
    }
  },
);

it.each(['commit', 'rollback'] as const)(
  'keeps B writes and cursor intact after stale rollback of A confirmed by %s',
  async (ending) => {
    const db = await database();
    const pool = new Pool({ connectionString: db.connectionString, max: 1 });
    const driver = descriptor.create({ cursor: { batchSize: 1 } });
    let held: SqlConnection | undefined;
    try {
      await driver.connect({ kind: 'pgPool', pool, ownedByDriver: true });
      held = await driver.acquireConnection();
      await held.execute({ sql: 'CREATE TEMP TABLE lease_rows (id integer)' });
      const a = await held.beginTransaction();
      await a[ending]();
      const b = await held.beginTransaction();
      await b.execute({ sql: 'INSERT INTO lease_rows VALUES (7)' });
      const rows = b.query({ sql: 'SELECT generate_series(1, 3) AS id' })[Symbol.asyncIterator]();
      expect(await rows.next()).toEqual({ done: false, value: { id: '1' } });
      await a.rollback();
      expect(await rows.next()).toEqual({ done: false, value: { id: '2' } });
      await b.commit();
      expect(await queryRows(held, 'SELECT id FROM lease_rows')).toEqual([{ id: '7' }]);
      await held.release();
    } finally {
      await held?.destroy();
      await driver.close();
      await db.close();
    }
  },
  timeouts.spinUpPpgDev,
);

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
