import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { timeouts } from '@repo/test-utils';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { queryRows } from './sql-queryable-test-utils';

let cleanup: (() => Promise<void>) | undefined;

async function createHarness(cursorDisabled = true) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const address = server.getServerConn();
  const pool = new Pool({
    host: '127.0.0.1',
    port: Number(address.slice(address.lastIndexOf(':') + 1)),
    database: 'postgres',
    user: 'postgres',
    max: 1,
    connectionTimeoutMillis: timeouts.default,
  });
  const driver = postgresRuntimeDriverDescriptor.create({
    cursor: { disabled: cursorDisabled, batchSize: 1 },
  });
  cleanup = async () => {
    await driver.close();
    await server.stop();
    await db.close();
  };
  await driver.connect({ kind: 'pgPool', pool });
  const release = vi.fn();
  pool.on('release', release);
  return { driver, pool, release };
}

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
}, timeouts.spinUpPpgDev);

describe('buffered pool release', () => {
  it.each([false, true])(
    'allows another query while the buffered consumer is paused (prepared: %s)',
    async (prepared) => {
      const { driver, pool, release } = await createHarness();
      let handle: unknown;
      const iterator = driver
        .query({
          sql: 'select generate_series(1, 2) as id',
          ...(prepared
            ? {
                preparedStatementHandle: {
                  get: () => handle,
                  set: (value: unknown) => {
                    handle = value;
                  },
                },
              }
            : {}),
        })
        [Symbol.asyncIterator]();
      try {
        expect(await iterator.next()).toEqual({ done: false, value: { id: 1 } });
        expect(pool.idleCount).toBe(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(await queryRows(driver, 'select 3 as id')).toEqual([{ id: 3 }]);
        expect(await iterator.next()).toEqual({ done: false, value: { id: 2 } });
        expect(await iterator.next()).toEqual({ done: true, value: undefined });
        expect(release).toHaveBeenCalledTimes(2);
      } finally {
        await iterator.return?.();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it.each(['return', 'throw'] as const)(
    'releases exactly once on consumer %s',
    async (exit) => {
      const { driver, release } = await createHarness();
      const iterator = driver
        .query({ sql: 'select generate_series(1, 2) as id' })
        [Symbol.asyncIterator]();
      try {
        await iterator.next();
        expect(release).toHaveBeenCalledTimes(1);
        if (exit === 'return') {
          await iterator.return?.();
        } else {
          await expect(iterator.throw?.(new Error('consumer failed'))).rejects.toThrow(
            'consumer failed',
          );
        }
        expect(release).toHaveBeenCalledTimes(1);
      } finally {
        await iterator.return?.();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'releases empty results and database errors exactly once',
    async () => {
      const { driver, release } = await createHarness();
      expect(await queryRows(driver, 'select 1 where false')).toEqual([]);
      expect(release).toHaveBeenCalledTimes(1);
      await expect(queryRows(driver, 'select * from missing_table')).rejects.toThrow();
      expect(release).toHaveBeenCalledTimes(2);
      expect(await queryRows(driver, 'select 3 as id')).toEqual([{ id: 3 }]);
      expect(release).toHaveBeenCalledTimes(3);
    },
    timeouts.spinUpPpgDev,
  );

  it.each([false, true])(
    'retains caller-owned connection (transaction: %s)',
    async (transactional) => {
      const { driver, pool, release } = await createHarness();
      const connection = await driver.acquireConnection();
      const transaction = transactional ? await connection.beginTransaction() : undefined;
      try {
        expect(await queryRows(transaction ?? connection, 'select 1 as id')).toEqual([{ id: 1 }]);
        expect(pool.idleCount).toBe(0);
        expect(release).not.toHaveBeenCalled();
      } finally {
        await transaction?.rollback();
        await connection.release();
      }
      expect(release).toHaveBeenCalledTimes(1);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'retains a real cursor lease until consumer abandonment',
    async () => {
      const { driver, pool, release } = await createHarness(false);
      const iterator = driver
        .query({ sql: 'select generate_series(1, 2) as id' })
        [Symbol.asyncIterator]();
      try {
        expect(await iterator.next()).toEqual({ done: false, value: { id: 1 } });
        expect(pool.idleCount).toBe(0);
        expect(release).not.toHaveBeenCalled();
      } finally {
        await iterator.return?.();
      }
      expect(release).toHaveBeenCalledTimes(1);
      expect(await queryRows(driver, 'select 3 as id')).toEqual([{ id: 3 }]);
    },
    timeouts.spinUpPpgDev,
  );
});
