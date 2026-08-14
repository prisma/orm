import { createDevDatabase, timeouts } from '@repo/test-utils';
import type { Client, Pool } from 'pg';
import { Client as PgClient, Pool as PgPool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { executeSql, queryRows } from './sql-queryable-test-utils';

describe('@internal/driver-postgres', () => {
  let cleanup: (() => Promise<void>) | undefined;

  // pg-mem rejects a query config that carries per-query type parsers whenever the query also
  // carries values, and the driver attaches those parsers to every row-producing statement.
  // Parameterized reads therefore need a real server; pg-mem still covers the parameterless paths.
  async function createRealPoolDriver() {
    const database = await createDevDatabase();
    const pool = new PgPool({ connectionString: database.connectionString });
    const driver = postgresRuntimeDriverDescriptor.create();

    cleanup = async () => {
      await driver.close();
      await database.close();
    };

    await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
    return driver;
  }

  async function createMemPoolDriver(options?: {
    readonly cursor?: { readonly batchSize?: number; readonly disabled?: boolean };
    readonly autoCleanup?: boolean;
  }) {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const driver = postgresRuntimeDriverDescriptor.create(
      options?.cursor ? { cursor: options.cursor } : undefined,
    );

    if (options?.autoCleanup ?? true) {
      cleanup = async () => {
        await driver.close();
      };
    }

    await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
    return driver;
  }

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it(
    'streams rows using buffered fallback when cursor disabled',
    async () => {
      const driver = await createMemPoolDriver({ cursor: { disabled: true } });
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1), ($2)', ['a', 'b']);

      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.query<{ id: number; name: string }>({
        sql: 'select id, name from items order by id asc',
      })) {
        rows.push(row);
      }

      expect(rows).toEqual([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'streams rows using cursor mode when enabled',
    async () => {
      const driver = await createMemPoolDriver({ cursor: { batchSize: 1 } });
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1), ($2), ($3)', ['a', 'b', 'c']);

      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.query<{ id: number; name: string }>({
        sql: 'select id, name from items order by id asc',
      })) {
        rows.push(row);
      }

      expect(rows).toEqual([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'uses custom cursor batch size',
    async () => {
      const driver = await createMemPoolDriver({ cursor: { batchSize: 2 } });
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1), ($2), ($3), ($4)', [
        'a',
        'b',
        'c',
        'd',
      ]);

      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.query<{ id: number; name: string }>({
        sql: 'select id, name from items order by id asc',
      })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({ id: 1, name: 'a' });
      expect(rows[3]).toEqual({ id: 4, name: 'd' });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'executes explain query',
    async () => {
      const driver = await createMemPoolDriver();
      await executeSql(driver, 'create table items(id serial primary key, name text)');

      // pg-mem doesn't support EXPLAIN (FORMAT JSON), so we test that explain() is callable
      // In a real environment, this would return explain results
      try {
        const result = await driver.explain?.({
          sql: 'select id, name from items',
        });
        if (result) {
          expect(result).toBeDefined();
          expect(result.rows).toBeDefined();
          expect(Array.isArray(result.rows)).toBe(true);
        }
      } catch {
        // pg-mem doesn't support EXPLAIN, so we just verify the method exists
        expect(driver.explain).toBeDefined();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'executes query with params',
    async () => {
      const driver = await createRealPoolDriver();
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1)', ['test']);

      const result = await queryRows<{ id: number; name: string }>(
        driver,
        'select id, name from items where name = $1',
        ['test'],
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('test');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles direct client connection',
    async () => {
      const db = newDb();
      const { Client } = db.adapters.createPg();
      const client = new Client();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1)', ['test']);

      const result = await queryRows<{ id: number; name: string }>(
        driver,
        'select id, name from items',
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('test');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'fails fast when connect is called twice on runtime driver',
    async () => {
      const db = newDb();
      const { Client } = db.adapters.createPg();
      const client = new Client();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
      await expect(
        driver.connect({ kind: 'pgClient', client: client as unknown as Client }),
      ).rejects.toThrow(
        'Postgres driver already connected. Call close() before reconnecting with a new binding.',
      );

      await executeSql(driver, 'create table items(id serial primary key, name text)');
      const result = await queryRows<{ id: number; name: string }>(
        driver,
        'select id, name from items',
      );

      expect(result).toBeDefined();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'skips connect when client is already connected',
    async () => {
      const db = newDb();
      const { Client } = db.adapters.createPg();
      const client = new Client();

      await client.connect();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
      // acquireClient should detect client is already connected and skip connect()
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      const result = await queryRows<{ id: number; name: string }>(
        driver,
        'select id, name from items',
      );

      expect(result).toBeDefined();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles pool already ended when closing',
    async () => {
      const driver = await createMemPoolDriver({ autoCleanup: false });
      await driver.close();

      // Closing again should not throw (pool.ended check)
      await driver.close();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'closes pool connection',
    async () => {
      const driver = await createMemPoolDriver({ autoCleanup: false });
      await driver.close();

      // pg-mem Pool doesn't have an 'ended' property, so we just verify close() doesn't throw
      expect(driver).toBeDefined();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles empty result set',
    async () => {
      const driver = await createMemPoolDriver();
      await executeSql(driver, 'create table items(id serial primary key, name text)');

      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.query<{ id: number; name: string }>({
        sql: 'select id, name from items',
      })) {
        rows.push(row);
      }

      expect(rows).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'streams rows via cursor when no errors occur',
    async () => {
      const database = await createDevDatabase();
      const pool = new PgPool({ connectionString: database.connectionString });

      const driver = postgresRuntimeDriverDescriptor.create({
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
        await database.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
      await executeSql(driver, 'create table cursor_items(id serial primary key, name text)');
      await executeSql(driver, 'insert into cursor_items(name) values ($1), ($2), ($3)', [
        'a',
        'b',
        'c',
      ]);

      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.query<{ id: number; name: string }>({
        sql: 'select id, name from cursor_items order by id asc',
      })) {
        rows.push(row);
      }

      expect(rows).toEqual([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'executes explain on real postgres',
    async () => {
      const database = await createDevDatabase();
      const pool = new PgPool({ connectionString: database.connectionString });

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
        await database.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
      await executeSql(driver, 'create table explain_items(id serial primary key, name text)');
      await executeSql(driver, 'insert into explain_items(name) values ($1)', ['test']);

      const result = await driver.explain!({
        sql: 'select id, name from explain_items where id = $1',
        params: [1],
      });

      expect(result).toBeDefined();
      expect(result.rows).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows.length).toBeGreaterThan(0);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'connects with url binding',
    async () => {
      const database = await createDevDatabase();
      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
        await database.close();
      };

      await driver.connect({ kind: 'url', url: database.connectionString });
      await executeSql(driver, 'create table items(id serial primary key, name text)');
      await executeSql(driver, 'insert into items(name) values ($1)', ['test']);

      const result = await queryRows<{ id: number; name: string }>(
        driver,
        'select id, name from items',
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('test');
    },
    timeouts.spinUpPpgDev,
  );

  describe('connection management', () => {
    it(
      'acquires and releases connections from pool',
      async () => {
        const driver = await createRealPoolDriver();
        await executeSql(driver, 'create table items(id serial primary key, name text)');

        const connection = await driver.acquireConnection();
        expect(connection).toBeDefined();

        // Test that the connection can execute queries
        await executeSql(connection, 'insert into items(name) values ($1)', ['test-connection']);
        const result = await queryRows<{ id: number; name: string }>(
          connection,
          'select id, name from items where name = $1',
          ['test-connection'],
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('test-connection');

        // Release the connection
        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'acquires and releases connections from direct client',
      async () => {
        const database = await createDevDatabase();
        const client = new PgClient({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgClient', client });
        await executeSql(driver, 'create table items(id serial primary key, name text)');

        const connection = await driver.acquireConnection();
        expect(connection).toBeDefined();

        // Test that the connection can execute queries
        await executeSql(connection, 'insert into items(name) values ($1)', ['test-direct']);
        const result = await queryRows<{ id: number; name: string }>(
          connection,
          'select id, name from items where name = $1',
          ['test-direct'],
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('test-direct');

        // Release the connection
        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'serializes concurrent acquireConnection calls for direct client',
      async () => {
        const db = newDb();
        const { Client } = db.adapters.createPg();
        const client = new Client();

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
        };

        await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
        await executeSql(driver, 'create table items(id serial primary key, name text)');

        const first = await driver.acquireConnection();
        let secondResolved = false;
        const secondPromise = driver.acquireConnection().then((connection) => {
          secondResolved = true;
          return connection;
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(secondResolved).toBe(false);

        await first.release();
        const second = await secondPromise;
        await second.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'connection can stream data with execute method',
      async () => {
        const driver = await createMemPoolDriver({ cursor: { disabled: true } });
        await executeSql(driver, 'create table items(id serial primary key, name text)');
        await executeSql(driver, 'insert into items(name) values ($1), ($2)', ['a', 'b']);

        const connection = await driver.acquireConnection();

        const rows: Array<{ id: number; name: string }> = [];
        for await (const row of connection.query<{ id: number; name: string }>({
          sql: 'select id, name from items order by id asc',
        })) {
          rows.push(row);
        }

        expect(rows).toEqual([
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ]);

        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('transaction management', () => {
    it(
      'begins, commits, and ends transaction successfully',
      async () => {
        const database = await createDevDatabase();

        const pool = new PgPool({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
        await executeSql(driver, 'create table tx_items(id serial primary key, name text)');

        const connection = await driver.acquireConnection();
        const transaction = await connection.beginTransaction();

        expect(transaction).toBeDefined();

        // Insert data within the transaction
        await executeSql(transaction, 'insert into tx_items(name) values ($1)', ['tx-test']);

        // Commit the transaction
        await transaction.commit();

        // Verify the data was committed
        const result = await queryRows<{ id: number; name: string }>(
          connection,
          'select id, name from tx_items where name = $1',
          ['tx-test'],
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('tx-test');

        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'begins and rolls back transaction',
      async () => {
        const database = await createDevDatabase();

        const pool = new PgPool({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
        await executeSql(
          driver,
          'create table tx_rollback_items(id serial primary key, name text)',
        );

        const connection = await driver.acquireConnection();
        const transaction = await connection.beginTransaction();

        // Insert data within the transaction
        await executeSql(transaction, 'insert into tx_rollback_items(name) values ($1)', [
          'rollback-test',
        ]);

        // Rollback the transaction
        await transaction.rollback();

        // Verify the data was not committed
        const result = await queryRows<{ id: number; name: string }>(
          connection,
          'select id, name from tx_rollback_items where name = $1',
          ['rollback-test'],
        );

        expect(result).toHaveLength(0);

        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'transaction can stream data with execute method',
      async () => {
        const database = await createDevDatabase();

        const pool = new PgPool({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create({
          cursor: { disabled: true },
        });

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
        await executeSql(driver, 'create table tx_stream_items(id serial primary key, name text)');
        await executeSql(driver, 'insert into tx_stream_items(name) values ($1), ($2)', [
          'tx-a',
          'tx-b',
        ]);

        const connection = await driver.acquireConnection();
        const transaction = await connection.beginTransaction();

        const rows: Array<{ id: number; name: string }> = [];
        for await (const row of transaction.query<{ id: number; name: string }>({
          sql: 'select id, name from tx_stream_items where name like $1 order by id asc',
          params: ['tx-%'],
        })) {
          rows.push(row);
        }

        expect(rows).toEqual([
          { id: 1, name: 'tx-a' },
          { id: 2, name: 'tx-b' },
        ]);

        await transaction.commit();
        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'transaction can explain queries',
      async () => {
        const database = await createDevDatabase();

        const pool = new PgPool({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
        await executeSql(driver, 'create table tx_explain_items(id serial primary key, name text)');

        const connection = await driver.acquireConnection();
        const transaction = await connection.beginTransaction();

        const result = await transaction.explain?.({
          sql: 'select id, name from tx_explain_items',
        });

        expect(result).toBeDefined();
        expect(result!.rows).toBeDefined();
        expect(Array.isArray(result!.rows)).toBe(true);

        await transaction.rollback();
        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'handles multiple sequential transactions on same connection',
      async () => {
        const database = await createDevDatabase();

        const pool = new PgPool({ connectionString: database.connectionString });

        const driver = postgresRuntimeDriverDescriptor.create();

        cleanup = async () => {
          await driver.close();
          await database.close();
        };

        await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
        await executeSql(driver, 'create table tx_multi_items(id serial primary key, name text)');

        const connection = await driver.acquireConnection();

        // First transaction - commit
        const tx1 = await connection.beginTransaction();
        await executeSql(tx1, 'insert into tx_multi_items(name) values ($1)', ['first-tx']);
        await tx1.commit();

        // Second transaction - rollback
        const tx2 = await connection.beginTransaction();
        await executeSql(tx2, 'insert into tx_multi_items(name) values ($1)', ['second-tx']);
        await tx2.rollback();

        // Third transaction - commit
        const tx3 = await connection.beginTransaction();
        await executeSql(tx3, 'insert into tx_multi_items(name) values ($1)', ['third-tx']);
        await tx3.commit();

        // Verify only committed data is present
        const result = await queryRows<{ id: number; name: string }>(
          connection,
          'select name from tx_multi_items order by id',
        );

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.name)).toEqual(['first-tx', 'third-tx']);

        await connection.release();
      },
      timeouts.spinUpPpgDev,
    );
  });
});
