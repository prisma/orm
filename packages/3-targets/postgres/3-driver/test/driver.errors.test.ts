import { SqlQueryError } from '@internal/sql-errors';
import { timeouts } from '@repo/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

describe('@internal/driver-postgres', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  it(
    'handles query errors',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();
      const driver = postgresRuntimeDriverDescriptor.create({ cursor: { disabled: true } });
      cleanups.push(async () => {
        await driver.close();
      });
      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool, ownedByDriver: true });
      await expect(queryRows(driver, 'select * from nonexistent_table')).rejects.toThrow();
    },
    timeouts.spinUpPpgDev,
  );

  it('normalizes non-Error cursor failures from execute()', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      // The non-Error cursor failure is rethrown without falling through
      // to buffered, so the mock only needs to model the cursor path.
      query: vi.fn(() => ({
        read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) =>
          cb('cursor failed with string', []),
        close: (cb: (err?: unknown) => void) => cb(),
      })),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const consume = async () => {
      for await (const _row of driver.query({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toThrow('cursor failed with string');
  });

  it('falls back to buffered mode when cursor throws non-postgres Error', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((statement: unknown) => {
        // The cursor throws an Error that isn't a pg error, so runQuery
        // falls through from cursor mode to buffered. Both shapes are hit
        // on the same client.query mock — Submittables (cursor) vs strings
        // / query configs (buffered).
        const isCursor =
          typeof statement === 'object' && statement !== null && 'submit' in statement;
        if (!isCursor) {
          return Promise.resolve({ rows: [{ id: 1, name: 'fallback' }] });
        }
        return {
          read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) =>
            cb(new Error('cursor unavailable'), []),
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.query<{ id: number; name: string }>({
      sql: 'select id, name from items',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1, name: 'fallback' }]);
  });

  it('normalizes postgres cursor failures as SqlQueryError', async () => {
    const pgCursorError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      // pg cursor errors are rethrown without falling through to buffered.
      query: vi.fn(() => ({
        read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) => cb(pgCursorError, []),
        close: (cb: (err?: unknown) => void) => cb(),
      })),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const consume = async () => {
      for await (const _row of driver.query({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(SqlQueryError);
  });

  it('rethrows non already-connected client connect errors', async () => {
    const mockClient = {
      _connection: undefined,
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {
        throw new Error('Connection failed: network error');
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      { disabled: true },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    await expect(queryRows(driver, 'select 1')).rejects.toThrow('Connection failed');
  });

  it('closes pool driver once when close called multiple times', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn(), on: () => undefined })),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );

    await driver.close();
    await driver.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('reports connected state for bound pool driver', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn(), on: () => undefined })),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    expect(driver.state).toBe('connected');
  });

  it('reports closed state for pool driver after close', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn(), on: () => undefined })),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );

    await driver.close();

    expect(driver.state).toBe('closed');
  });

  it('reuses in-flight connect promise for concurrent queries', async () => {
    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const mockClient = {
      _connection: undefined,
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {
        await connectPromise;
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      { disabled: true },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const first = queryRows(driver, 'select 1');
    const second = queryRows(driver, 'select 1');
    resolveConnect?.();
    await Promise.all([first, second]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it('reports connected state for bound direct driver', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    expect(driver.state).toBe('connected');
  });

  it('reports closed state for direct driver after close', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      undefined,
    );

    await driver.close();

    expect(driver.state).toBe('closed');
  });

  it('closes direct client once when close called multiple times', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      undefined,
    );

    await driver.close();
    await driver.close();

    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });

  it('releases direct connection without release method', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      on: () => undefined,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const connection = await driver.acquireConnection();
    await expect(connection.release()).resolves.toBeUndefined();
  });

  it(
    'releases lease when direct acquireConnection fails',
    async () => {
      const mockClient = {
        _connection: undefined,
        _ending: false,
        on: () => undefined,
        connect: vi.fn(async () => {
          throw new Error('connect failed');
        }),
        query: vi.fn(async () => ({ rows: [] })),
        end: vi.fn(async () => {}),
      };
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
        undefined,
      );
      cleanups.push(async () => {
        await driver.close();
      });

      await expect(driver.acquireConnection()).rejects.toThrow('connect failed');
      await expect(driver.acquireConnection()).rejects.toThrow('connect failed');
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    },
    timeouts.spinUpPpgDev,
  );

  it('destroy() evicts pool client by passing truthy error to PoolClient.release', async () => {
    const clientRelease = vi.fn();
    const poolClient = {
      on: () => undefined,
      query: vi.fn(async () => ({ rows: [] })),
      release: clientRelease,
    };
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => poolClient),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const connection = await driver.acquireConnection();
    const reason = new Error('rollback failed');
    await connection.destroy(reason);

    expect(clientRelease).toHaveBeenCalledTimes(1);
    const [firstArg] = clientRelease.mock.calls[0] ?? [];
    expect(firstArg).toBe(reason);
  });

  it('destroy() without an Error reason still evicts pool client with a truthy arg', async () => {
    const clientRelease = vi.fn();
    const poolClient = {
      on: () => undefined,
      query: vi.fn(async () => ({ rows: [] })),
      release: clientRelease,
    };
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => poolClient),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const connection = await driver.acquireConnection();
    await connection.destroy();

    expect(clientRelease).toHaveBeenCalledTimes(1);
    const [firstArg] = clientRelease.mock.calls[0] ?? [];
    expect(firstArg).toBeInstanceOf(Error);
  });

  it(
    'destroy() closes the direct-client driver',
    async () => {
      const mockClient = {
        _connection: {},
        _ending: false,
        on: () => undefined,
        connect: vi.fn(async () => {}),
        query: vi.fn(async () => ({ rows: [] })),
        end: vi.fn(async () => {}),
      };
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
        undefined,
      );
      cleanups.push(async () => {
        await driver.close();
      });

      const connection = await driver.acquireConnection();
      await connection.destroy(new Error('rollback failed'));

      expect(driver.state).toBe('closed');
      expect(mockClient.end).toHaveBeenCalledTimes(1);
    },
    timeouts.spinUpPpgDev,
  );

  it('destroy() propagates errors thrown by PoolClient.release', async () => {
    const releaseError = new Error('double release');
    const clientRelease = vi.fn(() => {
      throw releaseError;
    });
    const poolClient = {
      on: () => undefined,
      query: vi.fn(async () => ({ rows: [] })),
      release: clientRelease,
    };
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => poolClient),
      on: () => undefined,
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const connection = await driver.acquireConnection();
    // The caller decides whether to swallow teardown errors. The driver just
    // propagates them so context isn't silently lost.
    await expect(connection.destroy(new Error('boom'))).rejects.toBe(releaseError);
    expect(clientRelease).toHaveBeenCalledTimes(1);
  });

  it(
    'destroy() propagates errors thrown while closing the direct-client driver',
    async () => {
      const endError = new Error('end failed');
      const mockClient = {
        _connection: {},
        _ending: false,
        on: () => undefined,
        connect: vi.fn(async () => {}),
        query: vi.fn(async () => ({ rows: [] })),
        end: vi.fn(async () => {
          throw endError;
        }),
      };
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
        undefined,
      );

      const connection = await driver.acquireConnection();
      await expect(connection.destroy(new Error('rollback failed'))).rejects.toBe(endError);
      expect(mockClient.end).toHaveBeenCalledTimes(1);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'destroy() holds the direct-client lease until .end() completes, blocking concurrent acquireConnection',
    async () => {
      const events: string[] = [];
      let resolveEnd: (() => void) | undefined;
      const endPromise = new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });
      const mockClient = {
        _connection: {},
        _ending: false,
        on: () => undefined,
        connect: vi.fn(async () => {
          events.push('connect');
        }),
        query: vi.fn(async () => ({ rows: [] })),
        end: vi.fn(async () => {
          events.push('end:start');
          await endPromise;
          events.push('end:finish');
        }),
      };
      const driver = createBoundDriverFromBinding(
        { kind: 'pgClient', client: mockClient as unknown as Client, ownedByDriver: true },
        undefined,
      );

      const firstConnection = await driver.acquireConnection();

      // Kick off a concurrent acquire while the first connection's lease is
      // still held. It must queue behind the destroy's teardown.
      let concurrentResolved = false;
      const concurrentAcquire = driver.acquireConnection().then(
        (connection) => {
          events.push('concurrent:resolved');
          concurrentResolved = true;
          return { ok: true as const, connection };
        },
        (error: unknown) => {
          events.push('concurrent:rejected');
          concurrentResolved = true;
          return { ok: false as const, error };
        },
      );

      // Yield so acquireConnection() can enter the mutex queue before destroy
      // releases the lease.
      await Promise.resolve();
      await Promise.resolve();

      const destroyPromise = firstConnection.destroy(new Error('rollback failed'));

      // Let the teardown reach the .end() await. A generous number of
      // microtask yields keeps the test robust across runtimes without
      // resorting to real timers.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // .end() is in flight, and the concurrent acquireConnection() must not
      // have observed the direct client as reusable yet.
      expect(events).toContain('end:start');
      expect(concurrentResolved).toBe(false);
      expect(driver.state).toBe('closed');

      // Unblock .end(); teardown finishes, the concurrent caller proceeds and
      // observes the driver as closed (either by rejection or by getting a
      // connection that fails to reconnect the already-ended socket). Either
      // outcome is acceptable — the invariant is that the client is fully
      // ended before the caller observes a reusable state.
      resolveEnd?.();
      await destroyPromise;
      const outcome = await concurrentAcquire;

      const endFinishIndex = events.indexOf('end:finish');
      const concurrentIndex = events.findIndex(
        (event) => event === 'concurrent:resolved' || event === 'concurrent:rejected',
      );
      expect(endFinishIndex).toBeGreaterThanOrEqual(0);
      expect(concurrentIndex).toBeGreaterThan(endFinishIndex);

      if (outcome.ok) {
        // If the caller got a connection handle back, release it so cleanup
        // doesn't leak. The directClient is already ended, so release() just
        // drops our bookkeeping.
        await outcome.connection.release().catch(() => undefined);
      }

      expect(mockClient.end).toHaveBeenCalledTimes(1);
    },
    timeouts.spinUpPpgDev,
  );
});
