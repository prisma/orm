import type { SqlConnection } from '@internal/sql-relational-core/ast';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

async function withConnection(
  transport: 'pooled' | 'direct',
  run: (connection: SqlConnection, sent: string[]) => Promise<void>,
): Promise<void> {
  const database = await createDevDatabase();
  const sent: string[] = [];
  const watch = (client: pg.Client | pg.PoolClient) => {
    const original = client.query.bind(client);
    vi.spyOn(client, 'query').mockImplementation(((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string') sent.push(first);
      else if (first instanceof Object && 'text' in first && typeof first.text === 'string') {
        sent.push(first.text);
      }
      return Reflect.apply(original, client, args);
    }) as typeof client.query);
  };
  const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
  const client = new pg.Client({ connectionString: database.connectionString });
  pool.on('connect', watch);
  watch(client);
  const driver = createBoundDriverFromBinding(
    transport === 'pooled'
      ? { kind: 'pgPool', pool, ownedByDriver: true }
      : { kind: 'pgClient', client, ownedByDriver: true },
    { disabled: false, batchSize: 2 },
  );
  try {
    const connection = await driver.acquireConnection();
    try {
      await executeSql(connection, 'CREATE TABLE items (value int)');
      sent.length = 0;
      await run(connection, sent);
    } finally {
      await connection.release();
    }
  } finally {
    await driver.close();
    await database.close();
  }
}

const values = (connection: SqlConnection) =>
  queryRows(connection, 'SELECT value FROM items ORDER BY value');

describe.each(['pooled', 'direct'] as const)('%s savepoints', (transport) => {
  it(
    'keeps the work of a released savepoint',
    () =>
      withConnection(transport, async (connection, sent) => {
        const tx = await connection.beginTransaction();
        await executeSql(tx, 'INSERT INTO items VALUES (1)');
        const sp = await tx.savepoint('sp_1');
        await executeSql(sp, 'INSERT INTO items VALUES (2)');
        await sp.commit();
        await tx.commit();
        expect(await values(connection)).toEqual([{ value: '1' }, { value: '2' }]);
        expect(sent.slice(0, 6)).toEqual([
          'BEGIN',
          'INSERT INTO items VALUES (1)',
          'SAVEPOINT sp_1',
          'INSERT INTO items VALUES (2)',
          'RELEASE SAVEPOINT sp_1',
          'COMMIT',
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'loses the work of a rolled-back savepoint while the outer work commits',
    () =>
      withConnection(transport, async (connection, sent) => {
        const tx = await connection.beginTransaction();
        await executeSql(tx, 'INSERT INTO items VALUES (1)');
        const sp = await tx.savepoint('sp_1');
        await executeSql(sp, 'INSERT INTO items VALUES (2)');
        await sp.rollback();
        await executeSql(tx, 'INSERT INTO items VALUES (3)');
        await tx.commit();
        expect(await values(connection)).toEqual([{ value: '1' }, { value: '3' }]);
        expect(sent).toContain('ROLLBACK TO SAVEPOINT sp_1');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nests a savepoint inside a savepoint',
    () =>
      withConnection(transport, async (connection, sent) => {
        const tx = await connection.beginTransaction();
        const outer = await tx.savepoint('outer_sp');
        await executeSql(outer, 'INSERT INTO items VALUES (1)');
        const inner = await outer.savepoint('inner_sp');
        await executeSql(inner, 'INSERT INTO items VALUES (2)');
        await inner.rollback();
        await executeSql(outer, 'INSERT INTO items VALUES (3)');
        await outer.commit();
        await tx.commit();
        expect(await values(connection)).toEqual([{ value: '1' }, { value: '3' }]);
        expect(sent.filter((text) => /SAVEPOINT/.test(text))).toEqual([
          'SAVEPOINT outer_sp',
          'SAVEPOINT inner_sp',
          'ROLLBACK TO SAVEPOINT inner_sp',
          'RELEASE SAVEPOINT outer_sp',
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'recovers an aborted transaction by rolling back the savepoint',
    () =>
      withConnection(transport, async (connection) => {
        const tx = await connection.beginTransaction();
        await executeSql(tx, 'INSERT INTO items VALUES (1)');
        const sp = await tx.savepoint('sp_1');
        await expect(executeSql(sp, 'INSERT INTO missing VALUES (1)')).rejects.toMatchObject({
          sqlState: '42P01',
        });
        await expect(executeSql(tx, 'INSERT INTO items VALUES (2)')).rejects.toMatchObject({
          sqlState: '25P02',
        });
        await sp.rollback();
        await executeSql(tx, 'INSERT INTO items VALUES (3)');
        await tx.commit();
        expect(await values(connection)).toEqual([{ value: '1' }, { value: '3' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'keeps the connection inside the transaction after a savepoint settles',
    () =>
      withConnection(transport, async (connection, sent) => {
        const tx = await connection.beginTransaction();
        const released = await tx.savepoint('sp_1');
        await released.commit();
        const rolledBack = await tx.savepoint('sp_2');
        await rolledBack.rollback();
        sent.length = 0;
        await executeSql(tx, 'INSERT INTO items VALUES (1)');
        expect(await values(connection)).toEqual([{ value: '1' }]);
        expect(sent).toEqual([
          'INSERT INTO items VALUES (1)',
          'SELECT value FROM items ORDER BY value',
        ]);
        await tx.rollback();
        expect(await values(connection)).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );
});
