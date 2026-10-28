import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import mysqlRuntimeDriver from '../src/core/runtime/runtime-driver';
import { SESSION_SETUP } from '../src/core/session-setup';

/** How a fake result arrives: row by row as the caller reads (`rows`), all at once with its end before the caller reads (`received`), or as an error on the stream (`fails`) or thrown by `executeStream` itself (`throws`). `hidesState` hides Node's internal `_readableState` from the driver. */
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

class FakeStatement {
  parameterCount = 0;
  executeError: Error | undefined;
  readonly execute = vi.fn(async (_values?: unknown[]) => {
    if (this.executeError !== undefined) throw this.executeError;
    return { affectedRows: 3 };
  });
  readonly close = vi.fn();
  readonly streamClosed = vi.fn();
  constructor(private readonly behaviour: StreamBehaviour) {}

  executeStream(_values?: unknown[]): Readable {
    const behaviour = this.behaviour;
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
        this.streamClosed();
        pending.length = 0;
      },
    });
    return behaviour.hidesState ? withoutReadableState(closable) : closable;
  }
}

class FakeConnection extends EventEmitter {
  readonly release = vi.fn(async () => {});
  readonly destroy = vi.fn();
  readonly beginTransaction = vi.fn(async () => {});
  readonly commit = vi.fn(async () => {});
  readonly rollback = vi.fn(async () => {});
  readonly query = vi.fn(async () => []);
  readonly prepared: { sql: string; statement: FakeStatement }[] = [];
  behaviour: StreamBehaviour = { kind: 'rows', rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
  parameterCount = 0;
  prepareError: Error | undefined;
  executeError: Error | undefined;

  async prepare(sql: string): Promise<FakeStatement> {
    if (this.prepareError !== undefined) throw this.prepareError;
    const statement = new FakeStatement(this.behaviour);
    statement.parameterCount = this.parameterCount;
    statement.executeError = this.executeError;
    this.prepared.push({ sql, statement });
    return statement;
  }
}

class FakePool extends EventEmitter {
  readonly end = vi.fn(async () => {});
  constructor(
    readonly options: unknown,
    private readonly connection: FakeConnection,
  ) {
    super();
  }
  async getConnection(): Promise<FakeConnection> {
    return this.connection;
  }
}

const state = vi.hoisted(() => ({ pools: [] as unknown[] }));
let connection = new FakeConnection();

vi.mock('mariadb', () => ({
  createPool: (options: unknown) => {
    const pool = new FakePool(options, connection);
    state.pools.push(pool);
    return pool;
  },
}));

async function connected(url = 'mysql://root@localhost/db') {
  const driver = mysqlRuntimeDriver.create();
  await driver.connect({ kind: 'url', url });
  return driver;
}

function firstStatement(): FakeStatement {
  const statement = connection.prepared[0]?.statement;
  if (statement === undefined) throw new Error('no statement was prepared');
  return statement;
}

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
  it('creates the pool with the session setup, the statement cache off and the pool timeout', async () => {
    await connected('mysql://root@localhost/db?poolTimeout=250');
    expect(lastPool().options).toMatchObject({
      initSql: [...SESSION_SETUP],
      prepareCacheLength: 0,
      acquireTimeout: 250,
    });
  });

  it('listens to the pool, so a connection it fails to open does not crash the process', async () => {
    await connected();
    expect(() => lastPool().emit('error', new Error('connect ECONNREFUSED'))).not.toThrow();
  });

  it('returns a pooled connection to the pool after every statement, and closes each prepared statement', async () => {
    const driver = await connected();
    await driver.execute({ sql: 'SELECT 1' });
    await driver.execute({ sql: "SET time_zone = '+05:00'" });
    await collect(driver.query({ sql: 'SELECT n FROM t' }));
    expect({
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
      closed: connection.prepared.map(({ statement }) => statement.close.mock.calls.length),
      text: connection.query.mock.calls.length,
    }).toEqual({ released: 3, destroyed: 0, closed: [1, 1, 1], text: 0 });
  });

  it('reports the rows a statement changed', async () => {
    const driver = await connected();
    expect(await driver.execute({ sql: 'DELETE FROM t' })).toEqual({ affectedRows: 3 });
  });

  it('refuses a statement whose placeholders MySQL counts differently from the values, without running it', async () => {
    connection.parameterCount = 1;
    const driver = await connected();
    await expect(driver.execute({ sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
      meta: { prepared: 1, params: 0 },
    });
    const statement = firstStatement();
    expect({
      executed: statement.execute.mock.calls.length,
      closed: statement.close.mock.calls.length,
      released: connection.release.mock.calls.length,
    }).toEqual({ executed: 0, closed: 1, released: 1 });
  });

  it('destroys a pooled connection whose stream the caller stops early while the rest of the result is still arriving', async () => {
    const driver = await connected();
    for await (const _row of driver.query({ sql: 'SELECT n FROM t' })) break;
    const statement = firstStatement();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: statement.streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0, drained: 0 });
  });

  it('drops the rest of a pooled stream the caller stops early once the whole result has arrived, and returns the connection to the pool', async () => {
    connection.behaviour = { kind: 'received', rows: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    const driver = await connected();
    for await (const _row of driver.query({ sql: 'SELECT n FROM t' })) break;
    const statement = firstStatement();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: statement.streamClosed.mock.calls.length,
      closed: statement.close.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1, closed: 1 });
  });

  it('destroys a pooled connection whose stream the caller stops early when Node keeps no record of whether the result has arrived', async () => {
    connection.behaviour = {
      kind: 'received',
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      hidesState: true,
    };
    const driver = await connected();
    for await (const _row of driver.query({ sql: 'SELECT n FROM t' })) break;
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: firstStatement().streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 1, released: 0, drained: 0 });
  });

  it('drops the rest of a stream on a held connection the caller stops early when Node keeps no record of whether the result has arrived, and keeps the connection', async () => {
    connection.behaviour = {
      kind: 'received',
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
      hidesState: true,
    };
    const driver = await connected();
    const held = await driver.acquireConnection();
    for await (const _row of held.query({ sql: 'SELECT n FROM t' })) break;
    await held.release();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: firstStatement().streamClosed.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1 });
  });

  it('closes the prepared statement and reports the error when executeStream throws, and returns the connection to the pool', async () => {
    connection.behaviour = { kind: 'throws', error: mariadbError(false) };
    const driver = await connected();
    await expect(collect(driver.query({ sql: 'SELECT n FROM t' }))).rejects.toMatchObject({
      kind: 'sql_query',
      sqlState: '42S02',
    });
    expect({
      closed: firstStatement().close.mock.calls.length,
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
    }).toEqual({ closed: 1, released: 1, destroyed: 0 });
  });

  it('returns the connection to the pool after a statement error, from a stream, from execute and from prepare', async () => {
    const outcomes = [];
    for (const fail of ['stream', 'execute', 'prepare'] as const) {
      connection = new FakeConnection();
      if (fail === 'stream') connection.behaviour = { kind: 'fails', error: mariadbError(false) };
      if (fail === 'execute') connection.executeError = mariadbError(false);
      if (fail === 'prepare') connection.prepareError = mariadbError(false);
      const driver = await connected();
      const run =
        fail === 'stream'
          ? collect(driver.query({ sql: 'SELECT n FROM t' }))
          : driver.execute({ sql: 'DELETE FROM t' });
      await expect(run).rejects.toMatchObject({ kind: 'sql_query', sqlState: '42S02' });
      outcomes.push({
        fail,
        released: connection.release.mock.calls.length,
        destroyed: connection.destroy.mock.calls.length,
        closed: connection.prepared.map(({ statement }) => statement.close.mock.calls.length),
      });
    }
    expect(outcomes).toEqual([
      { fail: 'stream', released: 1, destroyed: 0, closed: [1] },
      { fail: 'execute', released: 1, destroyed: 0, closed: [1] },
      { fail: 'prepare', released: 1, destroyed: 0, closed: [] },
    ]);
  });

  it('destroys the connection when it is lost during prepare, from query as from execute', async () => {
    const outcomes = [];
    for (const call of ['query', 'execute'] as const) {
      connection = new FakeConnection();
      connection.prepareError = mariadbError(true);
      const driver = await connected();
      const run =
        call === 'query'
          ? collect(driver.query({ sql: 'SELECT n FROM t' }))
          : driver.execute({ sql: 'DELETE FROM t' });
      await expect(run).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
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
    const driver = await connected();
    const held = await driver.acquireConnection();
    for await (const _row of held.query({ sql: 'SELECT n FROM t' })) break;
    expect(await collect(held.query({ sql: 'SELECT n FROM t' }))).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
    await held.release();
    const first = firstStatement();
    expect({
      destroyed: connection.destroy.mock.calls.length,
      released: connection.release.mock.calls.length,
      drained: first.streamClosed.mock.calls.length,
      closed: first.close.mock.calls.length,
    }).toEqual({ destroyed: 0, released: 1, drained: 1, closed: 1 });
  });

  it('destroys the connection of a stream that loses it, and reports DRIVER.NOT_CONNECTED', async () => {
    connection.behaviour = {
      kind: 'fails',
      error: Object.assign(new Error('socket has unexpectedly been closed'), {
        errno: 45009,
        sqlState: '08S01',
        sqlMessage: 'socket has unexpectedly been closed',
        fatal: true,
      }),
    };
    const driver = await connected();
    await expect(collect(driver.query({ sql: 'SELECT 1' }))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
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
      text: connection.query.mock.calls.length,
      released: connection.release.mock.calls.length,
      destroyed: connection.destroy.mock.calls.length,
    }).toEqual({
      begun: 2,
      committed: 1,
      rolledBack: 1,
      text: 0,
      released: 1,
      destroyed: 0,
    });
  });

  it('destroys a held connection released while a stream on it is still open, instead of waiting for the stream, so close() finishes', async () => {
    const driver = await connected();
    const held = await driver.acquireConnection();
    const transaction = await held.beginTransaction();
    const rows = transaction.query({ sql: 'SELECT n FROM t' })[Symbol.asyncIterator]();
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
