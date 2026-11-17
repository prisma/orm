import type { SqlConnection } from '@internal/sql-relational-core/ast';
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

async function withConnection(
  test: Parameters<typeof withMysqlDatabase>[0],
  run: (connection: SqlConnection, client: PoolConnection) => Promise<void>,
): Promise<void> {
  await withMysqlDatabase(test, async ({ url }) => {
    const driver = mysqlRuntimeDriver.create({ poolOptions: { max: 1 } });
    await driver.connect({ kind: 'url', url });
    const connection = await driver.acquireConnection();
    try {
      await connection.execute({ sql: 'CREATE TABLE t (value INT) ENGINE=InnoDB' });
      const client = captured.clients.at(-1);
      if (!client) throw new Error('No acquired client');
      await run(connection, client);
    } finally {
      await connection.destroy();
      await driver.close();
    }
  });
}

const values = (connection: SqlConnection) =>
  collect(connection.query({ sql: 'SELECT value FROM t ORDER BY value' }));

describe('MySQL savepoints on a real connection', { timeout: timeouts.databaseOperation }, () => {
  it('keeps the work of a released savepoint', async (test) => {
    await withConnection(test, async (connection) => {
      const tx = await connection.beginTransaction();
      await tx.execute({ sql: 'INSERT INTO t VALUES (1)' });
      const sp = await tx.savepoint('sp_1');
      await sp.execute({ sql: 'INSERT INTO t VALUES (2)' });
      await sp.commit();
      await tx.commit();
      expect(await values(connection)).toEqual([{ value: '1' }, { value: '2' }]);
    });
  });

  it('loses the work of a rolled-back savepoint while the outer work commits', async (test) => {
    await withConnection(test, async (connection) => {
      const tx = await connection.beginTransaction();
      await tx.execute({ sql: 'INSERT INTO t VALUES (1)' });
      const sp = await tx.savepoint('sp_1');
      await sp.execute({ sql: 'INSERT INTO t VALUES (2)' });
      await sp.rollback();
      await tx.execute({ sql: 'INSERT INTO t VALUES (3)' });
      await tx.commit();
      expect(await values(connection)).toEqual([{ value: '1' }, { value: '3' }]);
    });
  });

  it('nests a savepoint inside a savepoint', async (test) => {
    await withConnection(test, async (connection) => {
      const tx = await connection.beginTransaction();
      const outer = await tx.savepoint('outer_sp');
      await outer.execute({ sql: 'INSERT INTO t VALUES (1)' });
      const inner = await outer.savepoint('inner_sp');
      await inner.execute({ sql: 'INSERT INTO t VALUES (2)' });
      await inner.rollback();
      await outer.execute({ sql: 'INSERT INTO t VALUES (3)' });
      await outer.commit();
      await tx.commit();
      expect(await values(connection)).toEqual([{ value: '1' }, { value: '3' }]);
    });
  });
});
