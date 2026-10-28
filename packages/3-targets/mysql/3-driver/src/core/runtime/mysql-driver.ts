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
import { isFatal, normalizeMysqlError, statementError } from '../normalize-error';
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

/** Prepares `request` on the server, its `?N` placeholders written as `?`, and checks MySQL's placeholder count against the values. */
async function prepareChecked(
  connection: PoolConnection,
  request: SqlExecuteRequest,
): Promise<{ readonly statement: Prepare; readonly sql: string; readonly values: unknown[] }> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  let statement: Prepare;
  try {
    statement = await connection.prepare(sql);
  } catch (error) {
    throw statementError(error, sql);
  }
  try {
    assertPreparedCount(statement, values.length);
  } catch (mismatch) {
    statement.close();
    throw mismatch;
  }
  return { statement, sql, values };
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

/** A pooled connection lent to one caller. `done` gives it back to the pool, or destroys it when it may be broken. */
interface Lent {
  readonly connection: PoolConnection;
  /** What to do when the caller stops reading a stream early: destroy a connection the pool lent for this one statement, or read and drop the rest of the result on a connection the caller holds, whose session must survive. */
  readonly onEarlyExit: 'destroy' | 'drain';
  done(destroy: boolean): Promise<void>;
}

/** What a statement reports back to whoever lent its connection. */
interface Outcome {
  destroy: boolean;
}

async function dropRest(rows: Readable & { close?: () => void }): Promise<void> {
  rows.close?.();
  rows.resume();
  await finished(rows);
}

/** The package can report an error on a stream after the caller stopped reading it, such as the one for a connection destroyed mid-result; the generator has already settled by then. */
function ignoreAfterStop(): void {}

/**
 * Streams the rows of `request` on `connection`, run as a prepared statement; the package pauses the socket while the caller is busy. When the caller stops reading early, a connection lent for this statement is destroyed, so a large result is not downloaded only to be thrown away; on a held connection the rest of the result is read and dropped, so its session stays usable. A fatal error, such as a lost connection, sets `outcome.destroy`.
 */
async function* streamRows<Row>(
  lent: Lent,
  request: SqlExecuteRequest,
  outcome: Outcome,
): AsyncGenerator<Row> {
  const { statement, sql, values } = await prepareChecked(lent.connection, request);
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
    if (isFatal(error)) outcome.destroy = true;
    throw statementError(error, sql);
  } finally {
    if (!settled && lent.onEarlyExit === 'destroy') {
      outcome.destroy = true;
    } else if (!settled) {
      await dropRest(rows).catch((error: unknown) => {
        if (isFatal(error)) outcome.destroy = true;
      });
    }
    if (outcome.destroy) rows.destroy();
    else statement.close();
  }
}

abstract class MysqlQueryable implements SqlQueryable {
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
    let destroy = false;
    try {
      const { statement, sql, values } = await prepareChecked(lent.connection, request);
      try {
        return { affectedRows: affectedRows(await statement.execute(values)) };
      } catch (error) {
        throw statementError(error, sql);
      } finally {
        statement.close();
      }
    } catch (error) {
      destroy = isFatal(error instanceof Error && error.cause !== undefined ? error.cause : error);
      throw error;
    } finally {
      await lent.done(destroy);
    }
  }
}

function lendHeld(connection: PoolConnection): Lent {
  return { connection, onEarlyExit: 'drain', done: async () => {} };
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

  constructor(connection: PoolConnection, giveBack: () => void) {
    super();
    this.#connection = connection;
    this.#giveBack = giveBack;
  }

  protected async lend(): Promise<Lent> {
    return lendHeld(this.#connection);
  }

  async beginTransaction(): Promise<SqlTransaction> {
    await transactionCall(() => this.#connection.beginTransaction());
    return new MysqlTransactionImpl(this.#connection);
  }

  async release(): Promise<void> {
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

  constructor(connection: PoolConnection) {
    super();
    this.#connection = connection;
  }

  protected async lend(): Promise<Lent> {
    return lendHeld(this.#connection);
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
        onEarlyExit: 'destroy',
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
