import { createDevDatabase, timeouts } from '@repo/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { executeSql, queryRows } from './sql-queryable-test-utils';

describe('@internal/driver-postgres runtime driver lifecycle', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  }, timeouts.spinUpPpgDev);

  function createDriver(options?: Parameters<typeof postgresRuntimeDriverDescriptor.create>[0]) {
    const driver = postgresRuntimeDriverDescriptor.create(options);
    cleanup = async () => {
      await driver.close();
    };
    return driver;
  }

  describe('descriptor.create', () => {
    it('returns an unbound driver with stable identity fields', () => {
      const driver = createDriver();

      expect(driver).toMatchObject({
        familyId: 'sql',
        targetId: 'postgres',
        acquireConnection: expect.any(Function),
        connect: expect.any(Function),
        close: expect.any(Function),
      });
    });

    it('accepts cursor options without requiring connection binding', () => {
      const driver = createDriver({ cursor: { batchSize: 10, disabled: false } });
      expect(driver).toBeDefined();
    });
  });

  describe('given an unbound driver', () => {
    const useBeforeConnectMessage =
      'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.';

    it('throws when acquireConnection is called', async () => {
      const driver = createDriver();
      await expect(driver.acquireConnection()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when query is called', async () => {
      const driver = createDriver();
      await expect(queryRows(driver, 'select 1')).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when execute is iterated', async () => {
      const driver = createDriver();
      const iter = driver.query({ sql: 'select 1' });
      const iterator = iter[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when explain is called', async () => {
      const driver = createDriver();
      expect(driver.explain).toBeDefined();
      await expect(driver.explain!({ sql: 'select 1' })).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: useBeforeConnectMessage,
      });
    });

    describe('after close()', () => {
      const closedMessage = 'Postgres driver is closed. Call connect(binding) to reconnect.';
      const closedError = {
        code: 'DRIVER.NOT_CONNECTED',
        category: 'DRIVER',
        message: closedMessage,
      };

      async function closedDriver() {
        const db = newDb();
        const { Pool: MemPool } = db.adapters.createPg();
        const driver = createDriver();
        await driver.connect({ kind: 'pgPool', pool: new MemPool() as unknown as Pool });
        await driver.close();
        return driver;
      }

      it('acquireConnection rejects with the closed message', async () => {
        const driver = await closedDriver();
        await expect(driver.acquireConnection()).rejects.toMatchObject(closedError);
      });

      it('query rejects with the closed message when iterated', async () => {
        const driver = await closedDriver();
        await expect(queryRows(driver, 'select 1')).rejects.toMatchObject(closedError);
      });

      it('execute rejects with the closed message', async () => {
        const driver = await closedDriver();
        await expect(executeSql(driver, 'select 1')).rejects.toMatchObject(closedError);
      });

      it('explain rejects with the closed message', async () => {
        const driver = await closedDriver();
        await expect(driver.explain!({ sql: 'select 1' })).rejects.toMatchObject(closedError);
      });
    });

    describe('while close() is pending', () => {
      it('execute and acquireConnection reject with the closed message', async () => {
        const db = newDb();
        const { Pool: MemPool } = db.adapters.createPg();
        const pool = new MemPool() as unknown as Pool;
        let finishEnd: () => void = () => {};
        const endGate = new Promise<void>((resolve) => {
          finishEnd = resolve;
        });
        const end = pool.end.bind(pool);
        pool.end = async () => {
          await endGate;
          await end();
        };
        const driver = createDriver();
        await driver.connect({ kind: 'pgPool', pool });

        const closing = driver.close();

        await expect(executeSql(driver, 'select 1')).rejects.toMatchObject({
          code: 'DRIVER.NOT_CONNECTED',
          message: 'Postgres driver is closed. Call connect(binding) to reconnect.',
        });
        await expect(driver.acquireConnection()).rejects.toMatchObject({
          code: 'DRIVER.NOT_CONNECTED',
          message: 'Postgres driver is closed. Call connect(binding) to reconnect.',
        });
        finishEnd();
        await closing;
      });
    });

    it(
      'exposes state transitions across connect close reconnect',
      async () => {
        const db = newDb();
        const { Pool: MemPool } = db.adapters.createPg();
        const poolA = new MemPool();
        const poolB = new MemPool();

        const driver = createDriver();
        expect(driver.state).toBe('unbound');

        await driver.connect({ kind: 'pgPool', pool: poolA as unknown as Pool });
        expect(driver.state).toBe('connected');

        await driver.close();
        expect(driver.state).toBe('closed');

        await driver.connect({ kind: 'pgPool', pool: poolB as unknown as Pool });
        expect(driver.state).toBe('connected');
      },
      timeouts.spinUpPpgDev,
    );

    describe('when connected with pgPool binding', () => {
      it(
        'queries successfully',
        async () => {
          const db = newDb();
          const { Pool: MemPool } = db.adapters.createPg();
          const memPool = new MemPool();

          const driver = createDriver();
          await driver.connect({ kind: 'pgPool', pool: memPool as unknown as Pool });

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
        'fails fast when connect is called twice',
        async () => {
          const db = newDb();
          const { Pool: MemPool } = db.adapters.createPg();
          const memPool = new MemPool();

          const driver = createDriver();
          const binding = { kind: 'pgPool' as const, pool: memPool as unknown as Pool };

          await driver.connect(binding);
          await expect(driver.connect(binding)).rejects.toMatchObject({
            code: 'DRIVER.ALREADY_CONNECTED',
            category: 'DRIVER',
            message:
              'Postgres driver already connected. Call close() before reconnecting with a new binding.',
          });

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
        'allows close to be called multiple times',
        async () => {
          const db = newDb();
          const { Pool: MemPool } = db.adapters.createPg();
          const memPool = new MemPool();

          const driver = createDriver();
          await driver.connect({ kind: 'pgPool', pool: memPool as unknown as Pool });

          cleanup = undefined;

          await driver.close();
          await driver.close();
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('when connected with pgClient binding', () => {
      it(
        'queries successfully',
        async () => {
          const db = newDb();
          const { Client: MemClient } = db.adapters.createPg();
          const memClient = new MemClient();

          const driver = createDriver();
          await driver.connect({ kind: 'pgClient', client: memClient as unknown as Client });

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
        'close works after connect',
        async () => {
          const db = newDb();
          const { Client: MemClient } = db.adapters.createPg();
          const memClient = new MemClient();

          const driver = createDriver();
          await driver.connect({ kind: 'pgClient', client: memClient as unknown as Client });

          cleanup = undefined;

          await driver.close();
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'transitions to closed state when connection.destroy() tears down the direct-client delegate',
        async () => {
          const db = newDb();
          const { Client: MemClient } = db.adapters.createPg();
          const memClient = new MemClient();

          const driver = createDriver();
          await driver.connect({ kind: 'pgClient', client: memClient as unknown as Client });
          expect(driver.state).toBe('connected');

          const connection = await driver.acquireConnection();
          await connection.destroy(new Error('rollback failed'));

          // A destroyed connection on a direct-client driver means its single
          // underlying socket is gone, so the outer runtime driver must also
          // reflect the closed state and refuse subsequent work — otherwise
          // callers would route queries to an already-ended delegate.
          expect(driver.state).toBe('closed');

          await expect(driver.acquireConnection()).rejects.toMatchObject({
            code: 'DRIVER.NOT_CONNECTED',
            category: 'DRIVER',
          });
          await expect(queryRows(driver, 'select 1')).rejects.toMatchObject({
            code: 'DRIVER.NOT_CONNECTED',
            category: 'DRIVER',
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('when connected with url binding', () => {
      it(
        'queries successfully',
        async () => {
          const database = await createDevDatabase();

          const driver = createDriver();
          cleanup = async () => {
            await driver.close();
            await database.close();
          };

          await driver.connect({ kind: 'url', url: database.connectionString });
          await executeSql(driver, 'create table url_items(id serial primary key, name text)');
          await executeSql(driver, 'insert into url_items(name) values ($1)', ['url-test']);

          const result = await queryRows<{ id: number; name: string }>(
            driver,
            'select id, name from url_items where name = $1',
            ['url-test'],
          );
          expect(result).toHaveLength(1);
          expect(result[0]?.name).toBe('url-test');
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
