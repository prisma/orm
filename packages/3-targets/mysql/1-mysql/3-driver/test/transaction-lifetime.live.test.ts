import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it, vi } from 'vitest';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';

async function collect<Row>(rows: AsyncIterable<Row>): Promise<Row[]> {
  const result: Row[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

const numbers = 'SELECT 1 AS n UNION ALL SELECT 2 AS n UNION ALL SELECT 3 AS n';

describe('MySQL transaction lifetime', { timeout: timeouts.databaseOperation }, () => {
  it.for(['commit', 'rollback'] as const)(
    'closes a parked stream on %s and protects the next transaction',
    async (ending, test) => {
      await withMysqlDatabase(test, async ({ url }) => {
        const driver = mysqlRuntimeDriver.create({ stream: true, poolOptions: { max: 1 } });
        await driver.connect({ kind: 'url', url });
        const connection = await driver.acquireConnection();
        try {
          await connection.execute({ sql: 'CREATE TABLE t (n INT)' });
          const tx = await connection.beginTransaction();
          await tx.execute({ sql: 'INSERT INTO t VALUES (1)' });
          const rows = tx.query({ sql: numbers })[Symbol.asyncIterator]();
          expect(await rows.next()).toEqual({ done: false, value: { n: '1' } });
          await tx[ending]();
          const next = await connection.beginTransaction();
          await next.execute({ sql: 'INSERT INTO t VALUES (2)' });
          await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
          await expect(tx.commit()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
          await next.rollback();
          expect(await collect(connection.query({ sql: 'SELECT n FROM t' }))).toEqual(
            ending === 'commit' ? [{ n: '1' }] : [],
          );
        } finally {
          await connection.destroy();
          await driver.close();
        }
      });
    },
  );

  it('upgrades release of a parked stream to destruction and never reuses its session', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create({ stream: true, poolOptions: { max: 1 } });
      await driver.connect({ kind: 'url', url });
      const connection = await driver.acquireConnection();
      try {
        const first = await collect(connection.query({ sql: 'SELECT CONNECTION_ID() AS id' }));
        await connection.execute({ sql: 'CREATE TABLE t (n INT)' });
        const tx = await connection.beginTransaction();
        await tx.execute({ sql: 'INSERT INTO t VALUES (1)' });
        const rows = tx.query({ sql: numbers })[Symbol.asyncIterator]();
        await rows.next();
        await Promise.all([connection.release(), connection.destroy()]);
        expect(await collect(driver.query({ sql: 'SELECT CONNECTION_ID() AS id' }))).not.toEqual(
          first,
        );
        expect(await collect(driver.query({ sql: 'SELECT n FROM t' }))).toEqual([]);
        await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
      } finally {
        await connection.destroy();
        await driver.close();
      }
    });
  });

  it('upgrades release while a statement is running and waits for cancellation before destruction', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const driver = mysqlRuntimeDriver.create({ poolOptions: { max: 2 } });
      await driver.connect({ kind: 'url', url });
      const connection = await driver.acquireConnection();
      try {
        const [first] = await collect(
          connection.query<{ id: string }>({ sql: 'SELECT CONNECTION_ID() AS id' }),
        );
        const sleeping = collect(connection.query({ sql: 'SELECT SLEEP(30) AS sleeping' })).then(
          () => 'completed',
          () => 'interrupted',
        );
        await vi.waitFor(async () => {
          expect(
            await collect(
              driver.query({
                sql: "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ?1 AND INFO LIKE 'SELECT SLEEP%'",
                params: [first?.id],
              }),
            ),
          ).toEqual([{ n: '1' }]);
        });
        await Promise.all([connection.release(), connection.destroy()]);
        expect(await sleeping).toBe('interrupted');
        expect(
          await collect(
            driver.query({
              sql: 'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ?1',
              params: [first?.id],
            }),
          ),
        ).toEqual([{ n: '0' }]);
      } finally {
        await connection.destroy();
        await driver.close();
      }
    });
  });
});
