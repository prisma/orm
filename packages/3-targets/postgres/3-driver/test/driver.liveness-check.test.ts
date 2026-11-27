import { EventEmitter } from 'node:events';
import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A client the pool hands out without emitting `connect`, so the driver has no record of its last use. */
function idleClient(query: (text: string) => Promise<unknown>, shape: object = {}) {
  const client = new EventEmitter();
  return Object.assign(client, shape, {
    release: vi.fn(),
    query: vi.fn((config: string | { readonly text: string }) =>
      query(typeof config === 'string' ? config : config.text),
    ),
  });
}

function poolOf(clients: () => unknown, max = 10): Pool & { connect: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), {
    options: { max },
    connect: vi.fn(async () => clients()),
    end: vi.fn(async () => {}),
  }) as unknown as Pool & { connect: ReturnType<typeof vi.fn> };
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function driverOver(pool: Pool, sessionSettings?: Record<string, string>) {
  const driver = createBoundDriverFromBinding(
    { kind: 'pgPool', pool, ownedByDriver: false },
    { disabled: true },
    sessionSettings === undefined ? undefined : { sessionSettings },
  );
  cleanups.push(() => driver.close());
  return driver;
}

describe('the liveness check of a pooled client', () => {
  it('uses a client that answers its empty statement with an error, which proves it alive', async () => {
    const client = idleClient(async (text) => {
      if (text === '') throw pgError('42601', 'syntax error');
      return { rows: [{ one: '1' }] };
    });
    const driver = driverOver(poolOf(() => client));

    expect(await queryRows(driver, 'select 1 as one')).toEqual([{ one: '1' }]);
    const [check, callers] = client.query.mock.calls.map(([config]) => config);
    expect(check).toEqual(expect.objectContaining({ text: '', query_timeout: 5000 }));
    expect(callers).toEqual(expect.objectContaining({ text: 'select 1 as one' }));
    expect(callers).not.toHaveProperty('query_timeout');
    expect(client.release.mock.calls).toEqual([[]]);
  });

  it('throws the error of the session settings statement that served as the check, as without one', async () => {
    const client = idleClient(async () => {
      throw pgError('22023', 'invalid value for parameter');
    });
    const driver = driverOver(
      poolOf(() => client),
      { DateStyle: 'nonsense' },
    );

    await expect(queryRows(driver, 'select 1')).rejects.toBeInstanceOf(SqlQueryError);
    expect(client.query.mock.calls.map(([config]) => config)).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(/^SELECT set_config\(/),
        query_timeout: 5000,
      }),
    ]);
    expect(client.release.mock.calls).toEqual([[true]]);
  });

  it('gives the last failed check once it has taken the pool max plus one clients', async () => {
    const reset = pgError('ECONNRESET', 'read ECONNRESET');
    const pool = poolOf(
      () =>
        idleClient(async () => {
          throw reset;
        }),
      1,
    );
    const driver = driverOver(pool);

    const error = await queryRows(driver, 'select 1').then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SqlConnectionError);
    expect(error).toHaveProperty('cause', reset);
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it('stops after the default pg-pool max plus one clients on a pool-like object with no max, and says what failed', async () => {
    const pool = Object.assign(new EventEmitter(), {
      connect: vi.fn(async () =>
        idleClient(async () => {
          throw new Error('Unexpected end of input');
        }),
      ),
      end: vi.fn(async () => {}),
    });
    const driver = driverOver(pool as unknown as Pool);

    const error = await queryRows(driver, 'select 1').then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SqlConnectionError);
    expect(error).toHaveProperty(
      'message',
      'A pooled Postgres connection gave no answer from the server to its liveness check (time limit 5000 ms): Unexpected end of input',
    );
    expect(pool.connect).toHaveBeenCalledTimes(11);
  });

  it.each([
    ['no connection', {}],
    ['a connection with no socket', { connection: {} }],
    ['a socket with no destroy method', { connection: { stream: {} } }],
  ])('evicts a dead client with %s by releasing it with an error', async (_shape, shape) => {
    const dead = idleClient(async () => {
      throw pgError('ECONNRESET', 'read ECONNRESET');
    }, shape);
    const live = idleClient(async () => ({ rows: [] }));
    const clients = [dead, live];
    const pool = poolOf(() => undefined);
    pool.connect.mockImplementation(async () => {
      const next = clients.shift();
      if (next === live) pool.emit('connect', live);
      return next;
    });
    const driver = driverOver(pool);

    expect(await queryRows(driver, 'select 1')).toEqual([]);
    expect(dead.release.mock.calls).toEqual([[expect.any(SqlConnectionError)]]);
  });

  it('destroys the socket of a client it evicts before releasing it', async () => {
    const order: string[] = [];
    const stream = { destroy: vi.fn(() => order.push('destroy')) };
    const dead = idleClient(
      async () => {
        throw pgError('ECONNRESET', 'read ECONNRESET');
      },
      { connection: { stream } },
    );
    dead.release.mockImplementation(() => order.push('release'));
    const live = idleClient(async () => ({ rows: [] }));
    const clients = [dead, live];
    const pool = poolOf(() => undefined);
    pool.connect.mockImplementation(async () => {
      const next = clients.shift();
      if (next === live) pool.emit('connect', live);
      return next;
    });
    const driver = driverOver(pool);

    await queryRows(driver, 'select 1');

    expect(order).toEqual(['destroy', 'release']);
  });
});
