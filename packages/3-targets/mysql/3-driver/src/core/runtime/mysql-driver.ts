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
import { assertPlaceholderCount } from '../placeholder-count';
import { positionalParams } from '../positional-params';

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
    assertPlaceholderCount(statement, values.length);
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
  let rows: Readable;
  try {
    rows = statement.executeStream(values);
  } catch (error) {
    statement.close();
    throw settle(error, outcome);
  }
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
  /** Lends a connection for one statement. */
  protected abstract lend(): Promise<Lent>;

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const lent = await this.lend();
    const outcome: Outcome = { destroy: false };
    try {
      yield* streamRows<Row>(lent, request, outcome);
    } finally {
      await lent.done(outcome.destroy);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const lent = await this.lend();
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

/** How many statements are running on a held connection, shared by the connection and its transactions as the Postgres driver shares its transaction state. A stream the caller dropped without finishing it stays running. */
interface RunningStatements {
  count: number;
}

/**
 * Lends a connection the caller holds. The package runs a connection's statements one at a time in the order they are sent, as `pg` did for the Postgres driver, so a statement sent while a stream on the connection is open waits for that stream to end. One awaited inside the stream's own loop therefore never finishes, as on Postgres with a cursor.
 */
function lendHeld(connection: PoolConnection, running: RunningStatements): Lent {
  running.count += 1;
  return {
    connection,
    held: true,
    done: async () => {
      running.count -= 1;
    },
  };
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
  readonly #connection: PoolConnection;
  readonly #giveBack: () => void;
  readonly #running: RunningStatements = { count: 0 };

  constructor(connection: PoolConnection, giveBack: () => void) {
    super();
    this.#connection = connection;
    this.#giveBack = giveBack;
  }

  protected async lend(): Promise<Lent> {
    return lendHeld(this.#connection, this.#running);
  }

  async beginTransaction(): Promise<SqlTransaction> {
    await transactionCall(() => this.#connection.beginTransaction());
    return new MysqlTransactionImpl(this.#connection, this.#running);
  }

  /**
   * Returns the connection to the pool, as the Postgres driver's `release()` does. A connection with a statement still running, such as a stream the caller dropped, is destroyed instead: the package's release sends `ROLLBACK` behind that statement and waits for it, which would never finish, where `pg`'s release does not wait on the server.
   */
  async release(): Promise<void> {
    if (this.#running.count > 0) return this.destroy();
    try {
      await this.#connection.release();
    } finally {
      this.#giveBack();
    }
  }

  async destroy(_reason?: unknown): Promise<void> {
    this.#connection.destroy();
    this.#giveBack();
  }
}

class MysqlTransactionImpl extends MysqlQueryable implements SqlTransaction {
  readonly #connection: PoolConnection;
  readonly #running: RunningStatements;

  constructor(connection: PoolConnection, running: RunningStatements) {
    super();
    this.#connection = connection;
    this.#running = running;
  }

  protected async lend(): Promise<Lent> {
    return lendHeld(this.#connection, this.#running);
  }

  async commit(): Promise<void> {
    await transactionCall(() => this.#connection.commit());
  }

  async rollback(): Promise<void> {
    await transactionCall(() => this.#connection.rollback());
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

  protected async lend(): Promise<Lent> {
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
