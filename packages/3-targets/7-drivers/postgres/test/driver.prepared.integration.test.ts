import type { SqlConnection, SqlQueryable } from '@internal/sql-relational-core/ast';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

function makeSlot(initial?: unknown) {
  let value: unknown = initial;
  return {
    slot: {
      get: () => value,
      set: (v: unknown) => {
        value = v;
      },
    },
    snapshot: () => value,
  };
}

async function consume<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of iterable) {
    out.push(row);
  }
  return out;
}

async function preparedNames(queryable: SqlQueryable): Promise<string[]> {
  const result = await queryRows<{ name: string }>(
    queryable,
    'select name from pg_prepared_statements order by name',
  );
  return result.map((row) => row.name);
}

describe('@internal/driver-postgres prepared statements', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  it(
    'reuses the server-side prepared statement across executes on the same connection',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined);
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t (id serial primary key, label text)');
      await executeSql(driver, "insert into t (label) values ('a'), ('b')");

      const { slot, snapshot } = makeSlot();
      expect(await preparedNames(driver)).toEqual([]);

      const r1 = await consume(
        driver.query<{ id: string; label: string }>({
          sql: 'select id, label from t where label = $1',
          params: ['a'],
          preparedStatementHandle: slot,
        }),
      );
      expect(r1).toEqual([{ id: '1', label: 'a' }]);

      const handleName = snapshot() as string;
      expect(handleName).toMatch(/^pn_\d+$/);
      expect(await preparedNames(driver)).toEqual([handleName]);

      const r2 = await consume(
        driver.query<{ id: string; label: string }>({
          sql: 'select id, label from t where label = $1',
          params: ['b'],
          preparedStatementHandle: slot,
        }),
      );
      expect(r2).toEqual([{ id: '2', label: 'b' }]);

      expect(await preparedNames(driver)).toEqual([handleName]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a different connection re-Parses the same handle name',
    async () => {
      // Two isolated dev databases — @prisma/dev shares server-side state
      // across sequential reconnects to a single instance, which would
      // surface as 42P05 "duplicate prepared statement".
      const databaseA = await createDevDatabase();
      const databaseB = await createDevDatabase();
      const Pg = await import('pg');

      async function setup(connectionString: string): Promise<void> {
        const c = new Pg.Client({ connectionString });
        await c.connect();
        await c.query('create table t2 (id serial primary key, label text)');
        await c.query("insert into t2 (label) values ('a')");
        await c.end();
      }
      await setup(databaseA.connectionString);
      await setup(databaseB.connectionString);

      const sql = 'select id, label from t2 where label = $1';
      const { slot, snapshot } = makeSlot();

      const clientA = new Pg.Client({ connectionString: databaseA.connectionString });
      const driverA = createBoundDriverFromBinding(
        { kind: 'pgClient', client: clientA },
        undefined,
      );
      cleanups.push(async () => {
        await driverA.close();
        await databaseA.close();
      });

      await consume(driverA.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      const name = snapshot() as string;
      expect(name).toMatch(/^pn_\d+$/);
      expect(await preparedNames(driverA)).toEqual([name]);

      const clientB = new Pg.Client({ connectionString: databaseB.connectionString });
      const driverB = createBoundDriverFromBinding(
        { kind: 'pgClient', client: clientB },
        undefined,
      );
      cleanups.push(async () => {
        await driverB.close();
        await databaseB.close();
      });

      await consume(driverB.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      expect(snapshot()).toBe(name);
      expect(await preparedNames(driverB)).toEqual([name]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'retries with a fresh handle on SQLSTATE 26000 after DEALLOCATE ALL',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined);
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t3 (id serial primary key, label text)');
      await executeSql(driver, "insert into t3 (label) values ('a'), ('b')");

      const { slot, snapshot } = makeSlot();
      const sql = 'select id, label from t3 where label = $1';

      const r1 = await consume(driver.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      expect(r1).toHaveLength(1);
      const firstHandle = snapshot() as string;

      // Forget every prepared statement server-side. pg's parsedStatements
      // still records firstHandle, so the next execute under the old name
      // would skip Parse on the wire and surface 26000 from the server.
      await executeSql(driver, 'deallocate all');

      const r2 = await consume(driver.query({ sql, params: ['b'], preparedStatementHandle: slot }));
      expect(r2).toHaveLength(1);
      expect((r2[0] as { label: string }).label).toBe('b');

      const retryHandle = snapshot() as string;
      expect(retryHandle).toMatch(/^pn_\d+$/);
      expect(retryHandle).not.toBe(firstHandle);
      expect(await preparedNames(driver)).toEqual([retryHandle]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'retries with a fresh handle on SQLSTATE 0A000 after a column type change',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined);
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t4 (id serial primary key, label text)');
      await executeSql(driver, "insert into t4 (label) values ('a'), ('b')");

      const { slot, snapshot } = makeSlot();
      // SELECT * so a column-shape change invalidates the cached plan.
      const sql = 'select * from t4 where id = $1';

      const r1 = await consume(driver.query({ sql, params: [1], preparedStatementHandle: slot }));
      expect(r1).toHaveLength(1);
      const firstHandle = snapshot() as string;

      await executeSql(driver, 'alter table t4 drop column label');
      await executeSql(driver, 'alter table t4 add column label varchar(50)');
      await executeSql(driver, "update t4 set label = 'b' where id = 2");

      const r2 = await consume(driver.query({ sql, params: [2], preparedStatementHandle: slot }));
      expect(r2).toHaveLength(1);
      const retryHandle = snapshot() as string;
      expect(retryHandle).toMatch(/^pn_\d+$/);
      expect(retryHandle).not.toBe(firstHandle);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'works inside an explicit transaction',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined);
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t5 (id serial primary key, label text)');

      const connection: SqlConnection = await driver.acquireConnection();
      const tx = await connection.beginTransaction();

      await executeSql(tx, "insert into t5 (label) values ('a'), ('b'), ('c')");

      const { slot, snapshot } = makeSlot();
      const sql = 'select id, label from t5 where label = $1';

      const r1 = await consume(tx.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      expect(r1).toEqual([{ id: '1', label: 'a' }]);

      const handle = snapshot() as string;
      expect(handle).toMatch(/^pn_\d+$/);

      const r2 = await consume(tx.query({ sql, params: ['b'], preparedStatementHandle: slot }));
      expect(r2).toEqual([{ id: '2', label: 'b' }]);
      expect(snapshot()).toBe(handle);

      await tx.commit();

      // PREPARE survives the transaction; only DEALLOCATE / end-of-session
      // discards it. The handle still resolves on the parent connection.
      const r3 = await consume(
        connection.query({ sql, params: ['c'], preparedStatementHandle: slot }),
      );
      expect(r3).toEqual([{ id: '3', label: 'c' }]);
      expect(snapshot()).toBe(handle);

      await connection.release();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'cursor.disabled buffers via the named-query path',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, { disabled: true });
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t7 (id serial primary key, label text)');
      await executeSql(driver, "insert into t7 (label) values ('a'), ('b')");

      const { slot, snapshot } = makeSlot();
      const sql = 'select id, label from t7 where label = $1';

      const r1 = await consume(driver.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      expect(r1).toEqual([{ id: '1', label: 'a' }]);
      const handle = snapshot() as string;
      expect(handle).toMatch(/^pn_\d+$/);

      const r2 = await consume(driver.query({ sql, params: ['b'], preparedStatementHandle: slot }));
      expect(r2).toEqual([{ id: '2', label: 'b' }]);

      expect(await preparedNames(driver)).toEqual([handle]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'preparedStatements: false issues anonymous queries',
    async () => {
      const database = await createDevDatabase();
      const Pg = await import('pg');
      const client = new Pg.Client({ connectionString: database.connectionString });
      const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined, {
        preparedStatements: false,
      });
      cleanups.push(async () => {
        await driver.close();
        await database.close();
      });

      await executeSql(driver, 'create table t6 (id serial primary key, label text)');
      await executeSql(driver, "insert into t6 (label) values ('a'), ('b')");

      const { slot, snapshot } = makeSlot();
      const sql = 'select id, label from t6 where label = $1';

      await consume(driver.query({ sql, params: ['a'], preparedStatementHandle: slot }));
      await consume(driver.query({ sql, params: ['b'], preparedStatementHandle: slot }));

      expect(snapshot()).toBeUndefined();
      expect(await preparedNames(driver)).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );
});
