import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';
import { SESSION_SETUP } from '../src/core/session-setup';

/** How a fake result arrives: row by row as the caller reads (`rows`), all at once with its end before the caller reads (`received`), or as an error on the stream (`fails`) or thrown by `queryStream` itself (`throws`). `hidesState` hides Node's internal `_readableState` from the driver. */
type StreamBehaviour = (
  | { kind: 'rows'; rows: unknown[] }
  | { kind: 'received'; rows: unknown[] }
  | { kind: 'fails'; error: Error }
  | { kind: 'throws'; error: Error }
) & { hidesState?: boolean };

/** `stream` as the driver sees it when Node keeps no `_readableState`; the stream's own methods still run on the real stream. */
function withoutReadableState(stream: Readable): Readable {
  return new Proxy(stream, {
    get(target, property) {
      if (property === '_readableState') return undefined;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function mariadbError(fatal: boolean): Error {
  return Object.assign(
    new Error(fatal ? 'socket has unexpectedly been closed' : "Table 't' doesn't exist"),
    {
      errno: fatal ? 45009 : 1146,
      sqlState: fatal ? '08S01' : '42S02',
      sqlMessage: fatal ? 'socket has unexpectedly been closed' : "Table 't' doesn't exist",
      fatal,
    },
  );
}

/** A result stream the fake connection returns from `queryStream`, closable as the package's is. */
function resultStream(behaviour: StreamBehaviour, closed: () => void): Readable {
  if (behaviour.kind === 'throws') throw behaviour.error;
  const pending = behaviour.kind === 'rows' ? [...behaviour.rows] : [];
  const stream = new Readable({
    objectMode: true,
    read() {
      if (behaviour.kind === 'fails') {
        queueMicrotask(() => this.emit('error', behaviour.error));
        return;
      }
      if (behaviour.kind === 'rows') this.push(pending.length > 0 ? pending.shift() : null);
    },
  });
  if (behaviour.kind === 'received') {
    for (const row of behaviour.rows) stream.push(row);
    stream.push(null);
  }
  const closable = Object.assign(stream, {
    close: () => {
      closed();
      pending.length = 0;
    },
  });
  return behaviour.hidesState ? withoutReadableState(closable) : closable;
}

class FakeConnection extends EventEmitter {
  readonly info = { threadId: 1, status: 0, collation: { charset: 'utf8', maxLength: 4 } };
  readonly release = vi.fn(async () => {});
  readonly destroy = vi.fn();
  readonly beginTransaction = vi.fn(async () => {});
  readonly commit = vi.fn(async () => {});
  readonly rollback = vi.fn(async () => {});
  result: unknown = [{ n: 1 }, { n: 2 }, { n: 3 }];
  queryError: Error | undefined;
  readonly query = vi.fn(async (_sql: string, _values?: unknown[]) => {
    if (this.queryError !== undefined) throw this.queryError;
    return this.result;
  });
  readonly streamClosed = vi.fn();
  readonly queryStream = vi.fn((_sql: string, _values?: unknown[]) =>
    resultStream(this.behaviour, this.streamClosed),
  );
  behaviour: StreamBehaviour = { kind: 'rows', rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
}

class FakePool extends EventEmitter {
  readonly end = vi.fn(async () => {});
  /** When set, `getConnection` waits until the test hands the connection over with `handOver`. */
  waits = false;
  readonly #waiting: ((connection: FakeConnection) => void)[] = [];
  constructor(
    readonly options: { readonly logger?: { readonly error?: (error: Error) => void } },
    private readonly connection: FakeConnection,
  ) {
    super();
  }
  /** A new wrapper over the one connection, as the package hands out for each `getConnection`. */
  #wrapper(): FakeConnection {
    return Object.create(this.connection);
  }
  async getConnection(): Promise<FakeConnection> {
    if (!this.waits) return this.#wrapper();
    return new Promise((resolve) => this.#waiting.push(resolve));
  }
  handOver(): void {
    for (const resolve of this.#waiting.splice(0)) resolve(this.#wrapper());
  }
  logError(error: Error): void {
    this.options.logger?.error?.(error);
  }
}

const state = vi.hoisted(() => ({ pools: [] as unknown[] }));
let connection = new FakeConnection();

vi.mock('mariadb', () => ({
  createPool: (options: ConstructorParameters<typeof FakePool>[0]) => {
    const pool = new FakePool(options, connection);
    state.pools.push(pool);
    return pool;
  },
}));

async function connected(options?: Parameters<typeof mysqlRuntimeDriver.create>[0]) {
  const driver = mysqlRuntimeDriver.create(options);
  await driver.connect({ kind: 'url', url: 'mysql://root@localhost/db' });
  return driver;
}

const streaming = { stream: true } as const;

const valued = { sql: 'SELECT n FROM t WHERE n > ?1', params: [0] };

/** The server status flag MySQL sets while the session's sql_mode includes NO_BACKSLASH_ESCAPES. */
const NO_BACKSLASH_ESCAPES = 1 << 9;

function lastPool(): FakePool {
  const pool = state.pools.at(-1);
  if (!(pool instanceof FakePool)) throw new Error('no pool');
  return pool;
}

async function collect<Row>(rows: AsyncIterable<Row>): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

beforeEach(() => {
  connection = new FakeConnection();
});

describe('MySQL runtime driver and its pool', () => {
  it('creates the pool with the session setup and the pool options, and no value in its SQL text', async () => {
    const driver = mysqlRuntimeDriver.create(
      { poolOptions: { connectionTimeoutMillis: 250 } },
      { time_zone: '+00:00' },
    );
    await driver.connect({ kind: 'url', url: 'mysql://root@localhost/db' });
    expect(lastPool().options).toMatchObject({
      initSql: [...SESSION_SETUP],
      acquireTimeout: 250,
      minimumIdle: 0,
    });
  });

  it('sets the session settings with one SET the first time it gets each connection, each value given to the package to write, an integer setting as a number', async () => {
    const driver = mysqlRuntimeDriver.create({}, { time_zone: '+00:00', sql_select_limit: '5' });
    await driver.connect({ kind: 'url', url: 'mysql://root@localhost/db' });
    await driver.execute({ sql: 'SELECT 1' });
    await driver.execute({ sql: 'SELECT 2' });
    const connectionHeld = await driver.acquireConnection();
    await connectionHeld.release();
    expect(connection.query.mock.calls).toEqual([
      ['SET SESSION `time_zone` = ?, `sql_select_limit` = ?', ['+00:00', 5n]],
      ['SELECT 1', undefined],
      ['SELECT 2', undefined],
    ]);
  });

  it('destroys a connection whose session settings MySQL refuses, and reports the error at once as the SqlQueryError MySQL raised', async () => {
    connection.queryError = Object.assign(new Error("Unknown or incorrect time zone: 'x'"), {
      errno: 1298,
      sqlState: 'HY000',
      sqlMessage: "Unknown or incorrect time zone: 'x'",
      fatal: false,
    });
    const driver = mysqlRuntimeDriver.create({}, { time_zone: 'x' });
    await driver.connect({ kind: 'url', url: 'mysql://root@localhost/db' });
    await expect(driver.execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      kind: 'sql_query',
      sqlState: 'HY000',
    });
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      ran: connection.query.mock.calls.map(([sql]) => sql),
    }).toEqual({ destroyed: 1, released: 0, ran: ['SET SESSION `time_zone` = ?'] });
    await driver.close();
  });

  it('fails the statements waiting for a connection at once when the package reports a sign-in that cannot succeed, as pg.Pool rejects a connect, and releases a connection handed over later', async () => {
    const driver = await connected();
    const pool = lastPool();
    pool.waits = true;
    const waiting = [driver.execute({ sql: 'SELECT 1' }), driver.execute({ sql: 'SELECT 2' })];
    await new Promise((resolve) => setImmediate(resolve));
    pool.logError(
      Object.assign(new Error("Access denied for user 'app'"), {
        errno: 1045,
        sqlState: '28000',
        sqlMessage: "Access denied for user 'app'",
        fatal: true,
      }),
    );
    const refused = expect.objectContaining({ kind: 'sql_query', sqlState: '28000' });
    expect(await Promise.allSettled(waiting)).toEqual([
      { status: 'rejected', reason: refused },
      { status: 'rejected', reason: refused },
    ]);
    pool.handOver();
    await new Promise((resolve) => setImmediate(resolve));
    expect({
      released: connection.release.mock.calls.length,
      ran: connection.query.mock.calls.length,
    }).toEqual({ released: 2, ran: 0 });
    await driver.close();
  });

  it('fails the statements waiting for a connection at once, as not transient, when the package reports a refused connection or an unknown or unreachable host, as pg.Pool does', async () => {
    const outcomes = [];
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH']) {
      const driver = await connected();
      const pool = lastPool();
      pool.waits = true;
      const waiting = driver.execute({ sql: 'SELECT 1' });
      await new Promise((resolve) => setImmediate(resolve));
      pool.logError(
        Object.assign(new Error(`connect ${code}`), {
          code,
          errno: -1,
          fatal: true,
          sqlState: 'HY000',
        }),
      );
      outcomes.push(await waiting.catch((error: unknown) => error));
      await driver.close();
    }
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: 'sql_connection', transient: false }),
      expect.objectContaining({ kind: 'sql_connection', transient: false }),
      expect.objectContaining({ kind: 'sql_connection', transient: false }),
    ]);
  });

  it('leaves the statements waiting for a connection waiting when the package reports the error of a statement, even one MySQL also refuses a sign-in with, or a lost connection', async () => {
    const driver = await connected();
    const pool = lastPool();
    pool.waits = true;
    const waiting = driver.execute({ sql: 'SELECT 1' });
    await new Promise((resolve) => setImmediate(resolve));
    pool.logError(
      Object.assign(new Error("Plugin 'no_such_plugin' is not loaded"), {
        errno: 1524,
        sqlState: 'HY000',
        sqlMessage: "Plugin 'no_such_plugin' is not loaded",
        fatal: false,
      }),
    );
    pool.logError(mariadbError(true));
    pool.logError(
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        errno: -54,
        fatal: true,
        sqlState: 'HY000',
      }),
    );
    pool.handOver();
    expect(await waiting).toEqual({ affectedRows: 0 });
    await driver.close();
  });

  it('sends a statement that arrives after a connection failure to the pool, which runs it once the pool opens a connection, as pg.Pool tries each connect afresh', async () => {
    const driver = await connected();
    const pool = lastPool();
    pool.waits = true;
    const first = driver.execute({ sql: 'SELECT 1' });
    await new Promise((resolve) => setImmediate(resolve));
    pool.logError(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        errno: -61,
        fatal: true,
        sqlState: 'HY000',
      }),
    );
    const failed = await first.catch((error: unknown) => error);
    const later = driver.execute({ sql: 'SELECT 2' });
    await new Promise((resolve) => setImmediate(resolve));
    pool.handOver();
    expect({ failed, later: await later }).toEqual({
      failed: expect.objectContaining({ kind: 'sql_connection', transient: false }),
      later: { affectedRows: 0 },
    });
    await driver.close();
  });

  it('listens to the pool, so a connection it fails to open does not crash the process', async () => {
    await connected();
    expect(() => lastPool().emit('error', new Error('connect ECONNREFUSED'))).not.toThrow();
  });

  it('sends every statement once over the text protocol, its values given to the package to write, and returns the connection after each', async () => {
    const driver = await connected();
    await driver.execute({ sql: 'SELECT ?2, ?1, ?2', params: ['a', 7] });
    await driver.execute({ sql: 'START TRANSACTION' });
    await collect(driver.query(valued));
    expect({
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
      sent: connection.query.mock.calls,
    }).toEqual({
      released: 3,
      destroyed: 0,
      sent: [
        ['SELECT ?, ?, ?', [7, 'a', 7]],
        ['START TRANSACTION', undefined],
        ['SELECT n FROM t WHERE n > ?', [0]],
      ],
    });
  });

  it('reads the whole result and returns the connection before the first row unless it streams, as Postgres does without a cursor', async () => {
    connection.result = [{ n: 1 }, { n: 2 }];
    const driver = await connected();
    const rows = driver.query(valued)[Symbol.asyncIterator]();
    const first = await rows.next();
    const releasedAtFirstRow = connection.release.mock.calls.length;
    expect({
      first,
      releasedAtFirstRow,
      rest: await collect({ [Symbol.asyncIterator]: () => rows }),
      streamed: connection.queryStream.mock.calls.length,
    }).toEqual({
      first: { done: false, value: { n: 1 } },
      releasedAtFirstRow: 1,
      rest: [{ n: 2 }],
      streamed: 0,
    });
  });

  it('streams the rows of a statement over the text protocol when it streams, its values given to the package to write', async () => {
    const driver = await connected(streaming);
    expect({
      rows: await collect(driver.query(valued)),
      none: await collect(driver.query({ sql: 'SELECT n FROM t' })),
      streamed: connection.queryStream.mock.calls,
      released: connection.release.mock.calls.length,
    }).toEqual({
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      none: [{ n: 1 }, { n: 2 }, { n: 3 }],
      streamed: [
        ['SELECT n FROM t WHERE n > ?', [0]],
        ['SELECT n FROM t', undefined],
      ],
      released: 2,
    });
  });

  it('refuses a statement with values while the server reports NO_BACKSLASH_ESCAPES, without sending it, and runs one without values', async () => {
    connection.info.status = NO_BACKSLASH_ESCAPES;
    const driver = await connected(streaming);
    const refusal = {
      code: 'RUNTIME.SQL_MODE_UNSUPPORTED',
      message: expect.stringContaining('NO_BACKSLASH_ESCAPES'),
      meta: { sqlMode: 'NO_BACKSLASH_ESCAPES', params: 1 },
    };
    await expect(driver.execute(valued)).rejects.toMatchObject(refusal);
    await expect(collect(driver.query(valued))).rejects.toMatchObject(refusal);
    await driver.execute({ sql: "SET SESSION sql_mode = ''" });
    expect({
      sent: connection.query.mock.calls,
      streamed: connection.queryStream.mock.calls.length,
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
    }).toEqual({
      sent: [["SET SESSION sql_mode = ''", undefined]],
      streamed: 0,
      released: 3,
      destroyed: 0,
    });
  });

  it('reports the rows a statement changed', async () => {
    connection.result = { affectedRows: 3 };
    const driver = await connected();
    expect(await driver.execute({ sql: 'DELETE FROM t WHERE n > ?1', params: [0] })).toEqual({
      affectedRows: 3,
    });
  });

  it('destroys a pooled connection whose stream the caller stops early while the rest of the result is still arriving', async () => {
    const driver = await connected(streaming);
    for await (const _row of driver.query(valued)) break;
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: connection.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0, drained: 0 });
  });

  it('drops the rest of a pooled stream the caller stops early once the whole result has arrived, and returns the connection to the pool', async () => {
    connection.behaviour = { kind: 'received', rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    const driver = await connected(streaming);
    for await (const _row of driver.query(valued)) break;
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: connection.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1 });
  });

  it('destroys a pooled connection whose stream the caller stops early when Node keeps no record of whether the result has arrived', async () => {
    connection.behaviour = {
      kind: 'received',
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      hidesState: true,
    };
    const driver = await connected(streaming);
    for await (const _row of driver.query(valued)) break;
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: connection.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0, drained: 0 });
  });

  it('drops the rest of a stream on a held connection the caller stops early when Node keeps no record of whether the result has arrived, and keeps the connection', async () => {
    connection.behaviour = {
      kind: 'received',
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      hidesState: true,
    };
    const driver = await connected(streaming);
    const held = await driver.acquireConnection();
    for await (const _row of held.query(valued)) break;
    await held.release();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: connection.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1 });
  });

  it('reports the error when queryStream throws, and returns the connection to the pool', async () => {
    connection.behaviour = { kind: 'throws', error: mariadbError(false) };
    const driver = await connected(streaming);
    await expect(collect(driver.query(valued))).rejects.toMatchObject({
      kind: 'sql_query',
      sqlState: '42S02',
    });
    expect({
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
    }).toEqual({ released: 1, destroyed: 0 });
  });

  it('returns the connection to the pool after a statement error, from a stream and from execute', async () => {
    const outcomes = [];
    for (const fail of ['stream', 'execute'] as const) {
      connection = new FakeConnection();
      if (fail === 'stream') connection.behaviour = { kind: 'fails', error: mariadbError(false) };
      else connection.queryError = mariadbError(false);
      const driver = await connected(streaming);
      const run =
        fail === 'stream'
          ? collect(driver.query(valued))
          : driver.execute({ sql: 'DELETE FROM t WHERE n > ?1', params: [0] });
      await expect(run).rejects.toMatchObject({ kind: 'sql_query', sqlState: '42S02' });
      outcomes.push({
        fail,
        released: connection.release.mock.calls.length,
        destroyed: connection.destroy.mock.calls.length,
      });
    }
    expect(outcomes).toEqual([
      { fail: 'stream', released: 1, destroyed: 0 },
      { fail: 'execute', released: 1, destroyed: 0 },
    ]);
  });

  it('destroys the connection when it is lost under a statement, from query as from execute', async () => {
    const outcomes = [];
    for (const call of ['query', 'execute'] as const) {
      connection = new FakeConnection();
      connection.queryError = mariadbError(true);
      const driver = await connected();
      const run =
        call === 'query'
          ? collect(driver.query(valued))
          : driver.execute({ sql: 'DELETE FROM t WHERE n > ?1', params: [0] });
      await expect(run).rejects.toMatchObject({ kind: 'sql_connection', transient: true });
      outcomes.push({
        call,
        released: connection.release.mock.calls.length,
        destroyed: connection.destroy.mock.calls.length,
      });
    }
    expect(outcomes).toEqual([
      { call: 'query', released: 0, destroyed: 1 },
      { call: 'execute', released: 0, destroyed: 1 },
    ]);
  });

  it('drops the rest of a stream on a held connection the caller stops early, and keeps the connection', async () => {
    const driver = await connected(streaming);
    const held = await driver.acquireConnection();
    for await (const _row of held.query(valued)) break;
    expect(await collect(held.query(valued))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    await held.release();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: connection.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1 });
  });

  it('destroys the connection of a stream that loses it, and reports a SqlConnectionError', async () => {
    connection.behaviour = {
      kind: 'fails',
      error: Object.assign(new Error('socket has unexpectedly been closed'), {
        errno: 45009,
        sqlState: '08S01',
        sqlMessage: 'socket has unexpectedly been closed',
        fatal: true,
      }),
    };
    const driver = await connected(streaming);
    await expect(collect(driver.query(valued))).rejects.toMatchObject({
      kind: 'sql_connection',
    });
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0 });
  });

  it('runs a transaction with the package transaction calls on the held connection, and returns it to the pool on release', async () => {
    const driver = await connected();
    const held = await driver.acquireConnection();
    const committed = await held.beginTransaction();
    await committed.execute({ sql: 'SET foreign_key_checks = 0' });
    await committed.commit();
    const rolledBack = await held.beginTransaction();
    await rolledBack.rollback();
    await held.release();
    expect({
      begun: connection.beginTransaction.mock.calls.length,
      committed: connection.commit.mock.calls.length,
      rolledBack: connection.rollback.mock.calls.length,
      text: connection.query.mock.calls.map(([sql]) => sql),
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
    }).toEqual({
      begun: 2,
      committed: 1,
      rolledBack: 1,
      text: ['SET foreign_key_checks = 0'],
      released: 1,
      destroyed: 0,
    });
  });

  it('destroys a held connection released while a stream on it is still open, instead of waiting for the stream, so close() finishes', async () => {
    const driver = await connected(streaming);
    const held = await driver.acquireConnection();
    const transaction = await held.beginTransaction();
    const rows = transaction.query(valued)[Symbol.asyncIterator]();
    await rows.next();
    await held.release();
    await driver.close();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      ended: lastPool().end.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0, ended: 1 });
  });

  it('ends the pool on close, after the connections it lent come back', async () => {
    const driver = await connected();
    const held = await driver.acquireConnection();
    const closing = driver.close();
    await Promise.resolve();
    const endedBeforeRelease = lastPool().end.mock.calls.length;
    await held.release();
    await closing;
    expect({ endedBeforeRelease, ended: lastPool().end.mock.calls.length }).toEqual({
      endedBeforeRelease: 0,
      ended: 1,
    });
  });
});
