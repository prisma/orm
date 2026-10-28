import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { errorRuntime } from '@internal/errors/execution';
import type { RuntimeDriverInstance } from '@internal/framework-components/execution';
import type {
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { createPool, type Pool, type PoolConnection, type Prepare } from 'mariadb';
import { mysqlPoolOptions } from '../connection-options';
import { isFatal, normalizeMysqlError } from '../normalize-error';
import { positionalParams } from '../positional-params';
import { assertPreparedCount } from '../prepared-count';

/** Where the runtime driver connects: a `mysql://` URL. */
export type MysqlBinding = { readonly kind: 'url'; readonly url: string };

export type MysqlRuntimeDriver = RuntimeDriverInstance<'sql', 'mysql'> & SqlDriver<MysqlBinding>;

function notConnected(message: string) {
  return errorRuntime('DRIVER.NOT_CONNECTED', message, {
    fix: 'Call connect(binding) before running queries, and do not use the driver after close().',
  });
}

/** Prepares `request` on the server, its `?N` placeholders written as `?`, and checks MySQL's placeholder count against the values. Throws the package's error as it is. */
async function prepareChecked(
  connection: PoolConnection,
  request: SqlExecuteRequest,
): Promise<{ readonly statement: Prepare; readonly values: unknown[] }> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  const statement = await connection.prepare(sql);
  try {
    assertPreparedCount(statement, values.length);
  } catch (mismatch) {
    statement.close();
    throw mismatch;
  }
  return { statement, values };
}

function affectedRows(result: unknown): number {
  return typeof result === 'object' &&
    result !== null &&
    'affectedRows' in result &&
    typeof result.affectedRows === 'number'
    ? result.affectedRows
    : 0;
}

/** Counts what the driver has handed out, a connection or a stream, so `close()` can wait until every one is back. */
class Leases {
  #count = 0;
  #idle: (() => void)[] = [];

  take(): () => void {
    this.#count += 1;
    let returned = false;
    return () => {
      if (returned) return;
      returned = true;
      this.#count -= 1;
      if (this.#count === 0) for (const resolve of this.#idle.splice(0)) resolve();
    };
  }

  idle(): Promise<void> {
    return this.#count === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.#idle.push(resolve));
  }
}

/** A connection lent to one statement. `done` gives a pooled connection back to the pool, or destroys it when it may be broken. */
interface Lent {
  readonly connection: PoolConnection;
  /** Whether the caller holds the connection, so its session must survive the statement. */
  readonly held: boolean;
  done(destroy: boolean): Promise<void>;
}

/** What a statement reports back to whoever lent its connection. */
interface Outcome {
  destroy: boolean;
}

/** The error to report for `error`, after noting in `outcome` whether it left the connection unusable. */
function settle(error: unknown, outcome: Outcome): unknown {
  if (isFatal(error)) outcome.destroy = true;
  return normalizeMysqlError(error);
}

/**
 * Whether the package has received the end of the result, so that any rows the caller has not read are already in the stream's buffer. The package pushes the end of the stream when MySQL's last packet arrives; Node records that in `_readableState.ended`, and its public API reports the end only after the caller has read every row.
 */
function resultReceived(rows: Readable): boolean {
  const state: unknown = Reflect.get(rows, '_readableState');
  return typeof state === 'object' && state !== null && 'ended' in state && state.ended === true;
}

async function dropRest(rows: Readable & { close?: () => void }): Promise<void> {
  rows.close?.();
  rows.resume();
  await finished(rows);
}

/**
 * Ends a stream the caller stopped reading early. Once the whole result has arrived, or on a held connection whose session must survive, the rest is read and dropped and the connection stays usable. A pooled connection whose result is still arriving is destroyed instead, so a large result is not downloaded only to be thrown away; MySQL does not say how many rows remain. Destroying it mid-result makes the package open one short-lived extra connection to send `KILL`, because MySQL cannot cancel a statement on its own connection.
 */
async function stopEarly(lent: Lent, rows: Readable, outcome: Outcome): Promise<void> {
  if (!lent.held && !resultReceived(rows)) {
    outcome.destroy = true;
    return;
  }
  await dropRest(rows).catch((error: unknown) => {
    if (isFatal(error)) outcome.destroy = true;
  });
}

/** The package can report an error on a stream after the caller stopped reading it, such as the one for a connection destroyed mid-result; the generator has already settled by then. */
function ignoreAfterStop(): void {}

/**
 * Streams the rows of `request` on `connection`, run as a prepared statement; the package pauses the socket while the caller is busy. A caller that stops reading early is handled by {@link stopEarly}. A fatal error, such as a lost connection, sets `outcome.destroy`, whether it comes from `prepare` or from the stream.
 */
async function* streamRows<Row>(
  lent: Lent,
  request: SqlExecuteRequest,
  outcome: Outcome,
): AsyncGenerator<Row> {
  const { statement, values } = await prepareChecked(lent.connection, request).catch(
    (error: unknown) => {
      throw settle(error, outcome);
    },
  );
  const rows = statement.executeStream(values);
  rows.on('error', ignoreAfterStop);
  let settled = false;
  try {
    for await (const row of rows.iterator({ destroyOnReturn: false })) {
      yield blindCast<
        Row,
        'the package streams the rows the statement produces, shaped by the query'
      >(row);
    }
    settled = true;
  } catch (error) {
    settled = true;
    throw settle(error, outcome);
  } finally {
    if (!settled) await stopEarly(lent, rows, outcome);
    if (outcome.destroy) rows.destroy();
    else statement.close();
  }
}

abstract class MysqlQueryable implements SqlQueryable {
  /** Lends a connection for one statement; `stream` says whether the statement streams its rows. */
  protected abstract lend(stream: boolean): Promise<Lent>;

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const lent = await this.lend(true);
    const outcome: Outcome = { destroy: false };
    try {
      yield* streamRows<Row>(lent, request, outcome);
    } finally {
      await lent.done(outcome.destroy);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const lent = await this.lend(false);
    const outcome: Outcome = { destroy: false };
    try {
      const { statement, values } = await prepareChecked(lent.connection, request);
      try {
        return { affectedRows: affectedRows(await statement.execute(values)) };
      } finally {
        statement.close();
      }
    } catch (error) {
      throw settle(error, outcome);
    } finally {
      await lent.done(outcome.destroy);
    }
  }
}

/**
 * A connection the caller holds, shared by the connection and the transactions begun on it. The package pauses the socket while a stream's caller is busy, and runs a connection's statements one after another, so a statement sent while a stream on the same connection is open waits for that stream, whose caller may be waiting for the statement. The session refuses such a statement instead.
 */
class HeldSession {
  readonly connection: PoolConnection;
  #streamOpen = false;

  constructor(connection: PoolConnection) {
    this.connection = connection;
  }

  /** Refuses to start anything while a stream on the connection is open. */
  assertIdle(): void {
    if (!this.#streamOpen) return;
    throw errorRuntime(
      'DRIVER.CONNECTION_BUSY',
      'A stream on this MySQL connection is still open',
      {
        why: 'MySQL runs one statement at a time on a connection, and the driver reads the open stream only as fast as its caller asks for rows. A statement sent now would wait for the stream to end, while the stream waits for the caller, so neither would finish.',
        fix: 'Finish or stop reading the stream before running another statement on the same connection or transaction, or collect its rows first with toArray().',
        meta: { target: 'mysql' },
      },
    );
  }

  lend(stream: boolean): Lent {
    this.assertIdle();
    if (!stream) return { connection: this.connection, held: true, done: async () => {} };
    this.#streamOpen = true;
    return {
      connection: this.connection,
      held: true,
      done: async () => {
        this.#streamOpen = false;
      },
    };
  }
}

async function transactionCall(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    throw normalizeMysqlError(error);
  }
}

/** A connection held by one caller, whose statements all run on the same session. */
class MysqlConnectionImpl extends MysqlQueryable implements SqlConnection {
  readonly #session: HeldSession;
  readonly #giveBack: () => void;

  constructor(connection: PoolConnection, giveBack: () => void) {
    super();
    this.#session = new HeldSession(connection);
    this.#giveBack = giveBack;
  }

  protected async lend(stream: boolean): Promise<Lent> {
    return this.#session.lend(stream);
  }

  async beginTransaction(): Promise<SqlTransaction> {
    this.#session.assertIdle();
    await transactionCall(() => this.#session.connection.beginTransaction());
    return new MysqlTransactionImpl(this.#session);
  }

  async release(): Promise<void> {
    try {
      await this.#session.connection.release();
    } finally {
      this.#giveBack();
    }
  }

  async destroy(_reason?: unknown): Promise<void> {
    this.#session.connection.destroy();
    this.#giveBack();
  }
}

class MysqlTransactionImpl extends MysqlQueryable implements SqlTransaction {
  readonly #session: HeldSession;

  constructor(session: HeldSession) {
    super();
    this.#session = session;
  }

  protected async lend(stream: boolean): Promise<Lent> {
    return this.#session.lend(stream);
  }

  async commit(): Promise<void> {
    this.#session.assertIdle();
    await transactionCall(() => this.#session.connection.commit());
  }

  async rollback(): Promise<void> {
    this.#session.assertIdle();
    await transactionCall(() => this.#session.connection.rollback());
  }
}

/** The pool reports a connection it failed to open on its `'error'` event, and again as the cause of a `getConnection` that times out; the driver reports it there. */
function ignoreConnectionFailure(): void {}

type DriverState =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'connected'; readonly pool: Pool }
  | { readonly kind: 'closed' };

/**
 * The MySQL runtime driver: a `mariadb` pool that runs every statement as a server-side prepared statement, so a value never travels inside the SQL. The pool runs the session setup once on each physical connection, and a connection goes back to the pool after each statement as it is; a broken connection is destroyed. `close()` waits for every connection and stream it has handed out before it ends the pool.
 */
export class MysqlDriver extends MysqlQueryable implements MysqlRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;

  #state: DriverState = { kind: 'unbound' };
  readonly #leases = new Leases();

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  async connect(binding: MysqlBinding): Promise<void> {
    if (this.#state.kind === 'connected') {
      throw errorRuntime('DRIVER.ALREADY_CONNECTED', 'MySQL driver already connected', {
        fix: 'Call close() before connecting again.',
      });
    }
    const pool = createPool(mysqlPoolOptions(binding.url));
    if (pool instanceof EventEmitter) pool.on('error', ignoreConnectionFailure);
    this.#state = { kind: 'connected', pool };
  }

  async acquireConnection(): Promise<SqlConnection> {
    const giveBack = this.#leases.take();
    try {
      return new MysqlConnectionImpl(await this.#acquire(), giveBack);
    } catch (error) {
      giveBack();
      throw error;
    }
  }

  protected async lend(_stream: boolean): Promise<Lent> {
    const giveBack = this.#leases.take();
    try {
      const connection = await this.#acquire();
      return {
        connection,
        held: false,
        done: async (destroy) => {
          try {
            if (destroy) connection.destroy();
            else await connection.release();
          } finally {
            giveBack();
          }
        },
      };
    } catch (error) {
      giveBack();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { pool } = this.#state;
    this.#state = { kind: 'closed' };
    await this.#leases.idle();
    await pool.end();
  }

  async #acquire(): Promise<PoolConnection> {
    if (this.#state.kind !== 'connected') {
      throw notConnected(
        this.#state.kind === 'closed' ? 'MySQL driver is closed' : 'MySQL driver not connected',
      );
    }
    try {
      return await this.#state.pool.getConnection();
    } catch (error) {
      throw normalizeMysqlError(error);
    }
  }
}
