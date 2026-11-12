import type { SqlConnection, SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import type { PoolConnection } from 'mariadb';
import { describe, expect, it, vi } from 'vitest';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';

const captured = vi.hoisted(() => ({ clients: [] as PoolConnection[] }));
vi.mock('mariadb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mariadb')>();
  return {
    ...actual,
    createPool: (...args: Parameters<typeof actual.createPool>) => {
      const pool = actual.createPool(...args);
      const acquire = pool.getConnection.bind(pool);
      vi.spyOn(pool, 'getConnection').mockImplementation(async () => {
        const client = await acquire();
        captured.clients.push(client);
        return client;
      });
      return pool;
    },
  };
});

async function collect<Row>(rows: AsyncIterable<Row>): Promise<Row[]> {
  const result: Row[] = [];
  for await (const row of rows) result.push(row);
  return result;
}
const single = { poolOptions: { max: 1 } };

async function driverAt(url: string) {
  const driver = mysqlRuntimeDriver.create(single);
  await driver.connect({ kind: 'url', url });
  return driver;
}

describe('MySQL next-transaction isolation on real pooled connections', {
  timeout: timeouts.databaseOperation,
}, () => {
  it.for([
    ['ReadUncommitted', '2', '2'],
    ['ReadCommitted', '1', '2'],
    ['RepeatableRead', '1', '1'],
  ] as const)(
    'observes %s semantics then restores a configured default around implicit starts',
    async ([isolationLevel, dirty, committed], test) => {
      await withMysqlDatabase(test, async ({ url }) => {
        const reader = await driverAt(url);
        const writer = await driverAt(url);
        let held: SqlConnection | undefined;
        let writing: SqlConnection | undefined;
        try {
          await reader.execute({
            sql: 'CREATE TABLE t (id INT PRIMARY KEY, value INT) ENGINE=InnoDB',
          });
          await reader.execute({ sql: 'INSERT INTO t VALUES (1, 1)' });
          held = await reader.acquireConnection();
          await held.execute({ sql: 'SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED' });
          const identity = await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }));
          writing = await writer.acquireConnection();
          const write = await writing.beginTransaction();
          await write.execute({ sql: 'UPDATE t SET value = 2 WHERE id = 1' });
          const selected = await held.beginTransaction({ isolationLevel });
          expect(await collect(selected.query({ sql: 'SELECT value FROM t' }))).toEqual([
            { value: dirty },
          ]);
          await write.commit();
          expect(await collect(selected.query({ sql: 'SELECT value FROM t' }))).toEqual([
            { value: committed },
          ]);
          await selected.commit();
          await held.release();
          held = await reader.acquireConnection();
          expect(await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }))).toEqual(
            identity,
          );
          const pending = await writing.beginTransaction();
          await pending.execute({ sql: 'UPDATE t SET value = 3 WHERE id = 1' });
          for (const [start, value] of [
            [{}, '3'],
            [{ isolationLevel: 'ReadCommitted' }, '2'],
            [undefined, '3'],
          ] as const) {
            const tx = await held.beginTransaction(start);
            expect(await collect(tx.query({ sql: 'SELECT value FROM t' }))).toEqual([{ value }]);
            await tx.rollback();
            await held.release();
            held = await reader.acquireConnection();
            expect(await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }))).toEqual(
              identity,
            );
          }
          await pending.rollback();
        } finally {
          await held?.destroy();
          await writing?.destroy();
          await reader.close();
          await writer.close();
        }
      });
    },
  );

  it('Serializable locks the read rows against a concurrent writer', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const reader = await driverAt(url);
      const writer = await driverAt(url);
      const held = await reader.acquireConnection();
      const writing = await writer.acquireConnection();
      try {
        await held.execute({ sql: 'CREATE TABLE t (id INT PRIMARY KEY, value INT) ENGINE=InnoDB' });
        await held.execute({ sql: 'INSERT INTO t VALUES (1, 1)' });
        await writing.execute({ sql: 'SET SESSION innodb_lock_wait_timeout = 1' });
        const tx = await held.beginTransaction({ isolationLevel: 'Serializable' });
        expect(await collect(tx.query({ sql: 'SELECT value FROM t' }))).toEqual([{ value: '1' }]);
        await expect(
          writing.execute({ sql: 'UPDATE t SET value = 2 WHERE id = 1' }),
        ).rejects.toThrow(/Lock wait timeout/);
        await tx.rollback();
        await writing.execute({ sql: 'UPDATE t SET value = 2 WHERE id = 1' });
        expect(await collect(held.query({ sql: 'SELECT value FROM t' }))).toEqual([{ value: '2' }]);
      } finally {
        await held.destroy();
        await writing.destroy();
        await reader.close();
        await writer.close();
      }
    });
  });

  it('evicts a successful SET interrupted by release before BEGIN and preserves the next borrower baseline', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create({
        ...single,
        sessionSettings: { transaction_isolation: 'REPEATABLE-READ' },
      });
      await driver.connect({ kind: 'url', url });
      const writer = await driverAt(url);
      let held = await driver.acquireConnection();
      const writing = await writer.acquireConnection();
      let resume = () => {};
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      try {
        await held.execute({ sql: 'CREATE TABLE t (id INT PRIMARY KEY, value INT) ENGINE=InnoDB' });
        await held.execute({ sql: 'INSERT INTO t VALUES (1, 1)' });
        const identity = await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }));
        const client = captured.clients.at(-2);
        if (!client) throw new Error('No acquired reader client');
        const query = client.query.bind(client);
        let entered = () => {};
        const entering = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const intercepted = vi.spyOn(client, 'query').mockImplementationOnce(async (...args) => {
          const result = await query(...args);
          entered();
          await paused;
          return result;
        });
        const begin = vi.spyOn(client, 'beginTransaction');
        const starting = held.beginTransaction({ isolationLevel: 'ReadUncommitted' });
        const rejected = expect(starting).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
        await entering;
        const releasing = held.release();
        resume();
        await Promise.all([rejected, releasing]);
        expect(intercepted).toHaveBeenCalledWith(
          'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED',
        );
        expect(begin).not.toHaveBeenCalled();
        held = await driver.acquireConnection();
        const replacement = await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }));
        const write = await writing.beginTransaction();
        await write.execute({ sql: 'UPDATE t SET value = 2 WHERE id = 1' });
        const next = await held.beginTransaction();
        expect(await collect(next.query({ sql: 'SELECT value FROM t' }))).toEqual([{ value: '1' }]);
        await write.commit();
        expect(await collect(next.query({ sql: 'SELECT value FROM t' }))).toEqual([{ value: '1' }]);
        await next.rollback();
        expect(replacement).not.toEqual(identity);
      } finally {
        resume();
        await held.destroy();
        await writing.destroy();
        await driver.close();
        await writer.close();
      }
    });
  });

  it.for(['set', 'begin'] as const)(
    'evicts after failed %s so pending next-transaction settings cannot be reused',
    async (point, test) => {
      await withMysqlDatabase(test, async ({ url }) => {
        const driver = await driverAt(url);
        let held = await driver.acquireConnection();
        try {
          const identity = await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }));
          const client = captured.clients.at(-1);
          if (!client) throw new Error('No acquired client');
          const failure = new Error(`${point} failed`);
          if (point === 'set') vi.spyOn(client, 'query').mockRejectedValueOnce(failure);
          else vi.spyOn(client, 'beginTransaction').mockRejectedValueOnce(failure);
          await expect(
            held.beginTransaction({
              isolationLevel: 'Serializable',
            } satisfies SqlTransactionOptions),
          ).rejects.toBe(failure);
          await held.release();
          held = await driver.acquireConnection();
          expect(await collect(held.query({ sql: 'SELECT CONNECTION_ID() AS id' }))).not.toEqual(
            identity,
          );
          const tx = await held.beginTransaction();
          await tx.rollback();
        } finally {
          await held.destroy();
          await driver.close();
        }
      });
    },
  );
});
