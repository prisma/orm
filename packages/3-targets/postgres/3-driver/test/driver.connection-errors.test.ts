import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { SqlConnectionError } from '@internal/sql-errors';
import { Client, type Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

function fakeClient(query: (client: EventEmitter) => Promise<unknown>) {
  const client = new EventEmitter();
  return Object.assign(client, {
    _connection: {},
    _ending: false,
    release: vi.fn(),
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(() => query(client)),
  });
}

function fakePool(connect: () => Promise<unknown>): Pool {
  return {
    connect: vi.fn(connect),
    end: vi.fn(async () => {}),
    on: () => undefined,
  } as unknown as Pool;
}

const codeLessError = () => new Error('Connection terminated unexpectedly');

describe('postgres driver connection errors', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  describe('pool driver', () => {
    it('classifies a code-less error from pool.connect() as a connection error', async () => {
      const cause = new Error('timeout exceeded when trying to connect');
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool: fakePool(async () => Promise.reject(cause)), ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toMatchObject({
        kind: 'sql_connection',
        cause,
      });
      await expect(driver.acquireConnection()).rejects.toBeInstanceOf(SqlConnectionError);
    });

    it('classifies a code-less query error after the client ended as a connection error', async () => {
      const client = fakeClient(async (emitter) => {
        emitter.emit('end');
        throw codeLessError();
      });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool: fakePool(async () => client), ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlConnectionError);
    });

    it('classifies a cursor-mode error after the client errored as a connection error', async () => {
      const client = fakeClient(async (emitter) => {
        emitter.emit('error', codeLessError());
        throw codeLessError();
      });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool: fakePool(async () => client), ownedByDriver: true },
        { batchSize: 1 },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlConnectionError);
    });

    it('leaves a code-less query error on a live client unclassified', async () => {
      const cause = codeLessError();
      const client = fakeClient(async () => {
        throw cause;
      });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool: fakePool(async () => client), ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toBe(cause);
    });

    it('classifies a transaction statement error after the client ended', async () => {
      const client = fakeClient(async (emitter) => {
        emitter.emit('end');
        throw codeLessError();
      });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgPool', pool: fakePool(async () => client), ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      const connection = await driver.acquireConnection();
      await expect(connection.beginTransaction()).rejects.toBeInstanceOf(SqlConnectionError);
    });
  });

  describe('direct driver', () => {
    it('classifies a code-less error from client.connect() as a connection error', async () => {
      const client = fakeClient(async () => ({ rows: [] }));
      client.connect.mockRejectedValue(new Error('connect failed'));
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: client as unknown as Client, ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlConnectionError);
      await expect(driver.acquireConnection()).rejects.toBeInstanceOf(SqlConnectionError);
    });

    it('classifies a code-less query error after the client errored as a connection error', async () => {
      const client = fakeClient(async (emitter) => {
        emitter.emit('error', codeLessError());
        throw codeLessError();
      });
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: client as unknown as Client, ownedByDriver: true },
        { disabled: true },
      );
      cleanups.push(() => driver.close());

      await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlConnectionError);
    });

    describe('with a real pg client', () => {
      let server: Server | undefined;
      const sockets: Socket[] = [];

      afterEach(async () => {
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      });

      it('classifies pg’s connect timeout as a connection error', async () => {
        server = createServer((socket) => sockets.push(socket));
        await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const client = new Client({ host: '127.0.0.1', port, connectionTimeoutMillis: 50 });
        const driver = createBoundDriverFromBinding(
          { kind: 'pgClient', client, ownedByDriver: true },
          { disabled: true },
        );

        await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlConnectionError);
      });
    });
  });
});
