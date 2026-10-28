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
import { ifDefined } from '@internal/utils/defined';
import { createPool, type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2';
import { mysqlConnectionOptions, mysqlPoolSettings } from '../connection-options';
import { connectionLost, isFatal, normalizeMysqlError, statementError } from '../normalize-error';
import { positionalParams } from '../positional-params';
import { assertPreparedCount } from '../prepared-count';
import { SESSION_SETUP } from '../session-setup';

/** Where the runtime driver connects: a `mysql://` URL. */
export type MysqlBinding = { readonly kind: 'url'; readonly url: string };

export type MysqlRuntimeDriver = RuntimeDriverInstance<'sql', 'mysql'> & SqlDriver<MysqlBinding>;

function notConnected(message: string) {
  return errorRuntime('DRIVER.NOT_CONNECTED', message, {
    fix: 'Call connect(binding) before running queries, and do not use the driver after close().',
  });
}

/** Prepares `sql`, which mysql2 caches for the `execute()` that follows, and checks MySQL's placeholder count against the values. */
function prepareChecked(
  connection: PoolConnection,
  sql: string,
  values: readonly unknown[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.prepare(sql, (error, statement) => {
      if (error) return reject(statementError(error, sql));
      try {
        assertPreparedCount(statement, values.length);
        resolve();
      } catch (mismatch) {
        reject(mismatch);
      }
    });
  });
}

/** Runs a statement as a server-side prepared statement, its values sent apart from the SQL. */
async function run(connection: PoolConnection, request: SqlExecuteRequest): Promise<unknown> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  await prepareChecked(connection, sql, values);
  return new Promise((resolve, reject) => {
    connection.execute({ sql, values }, (error, result) => {
      if (error) return reject(statementError(error, sql));
      resolve(result);
    });
  });
}

/** Runs SQL the driver writes itself, with no values, through the text protocol: the session setup and `START TRANSACTION`, which MySQL does not prepare. */
function runConstant(connection: PoolConnection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error) => (error ? reject(normalizeMysqlError(error)) : resolve()));
  });
}

function isResultSetHeader(result: unknown): result is ResultSetHeader {
  return typeof result === 'object' && result !== null && 'affectedRows' in result;
}

async function setUpSession(connection: PoolConnection): Promise<void> {
  for (const sql of SESSION_SETUP) await runConstant(connection, sql);
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
  /** What to do when the caller stops reading a stream early: evict a connection the pool lent for this one statement, or read and drop the rest of the result on a connection the caller holds, whose session must survive. */
  readonly onEarlyExit: 'evict' | 'drain';
  done(evict: boolean): void;
}

/** What a stream reports back to whoever lent its connection. */
interface StreamOutcome {
  evict: boolean;
}

interface StreamOptions {
  readonly onEarlyExit: Lent['onEarlyExit'];
  readonly outcome: StreamOutcome;
}

/**
 * Streams the rows of `request` on `connection`, run as a prepared statement. When the caller stops reading early, the connection is evicted, or on a held connection it reads and drops the rest of the result so its session stays usable. mysql2 tells a streaming query nothing when its connection is lost, so the stream listens to the connection and ends with `DRIVER.NOT_CONNECTED`. A lost connection, or a fatal error, sets `outcome.evict`.
 */
async function* streamRows<Row>(
  connection: PoolConnection,
  request: SqlExecuteRequest,
  { onEarlyExit, outcome }: StreamOptions,
): AsyncGenerator<Row> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  await prepareChecked(connection, sql, values);
  const command = connection.execute({ sql, values });
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
    command.once('end', () => resolve());
  });
  const stream = command.stream();
  const onLost = (cause?: unknown) => {
    outcome.evict = true;
    stream.destroy(connectionLost(cause));
    settle();
  };
  connection.once('end', onLost);
  connection.once('error', onLost);
  let completed = false;
  let failed = false;
  try {
    for await (const row of stream) {
      yield blindCast<Row, 'mysql2 streams the rows the statement produces, shaped by the query'>(
        row,
      );
    }
    completed = true;
  } catch (error) {
    failed = true;
    if (isFatal(error)) outcome.evict = true;
    throw statementError(error, sql);
  } finally {
    const stoppedEarly = !completed && !failed && !outcome.evict;
    if (stoppedEarly && onEarlyExit === 'evict') {
      outcome.evict = true;
      stream.destroy();
      settle();
    } else if (stoppedEarly) {
      connection.resume();
    }
    if (!failed) await finished;
    connection.off('end', onLost);
    connection.off('error', onLost);
  }
}

abstract class MysqlQueryable implements SqlQueryable {
  protected abstract lend(): Promise<Lent>;

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const lent = await this.lend();
    const outcome: StreamOutcome = { evict: false };
    try {
      yield* streamRows<Row>(lent.connection, request, {
        onEarlyExit: lent.onEarlyExit,
        outcome,
      });
    } finally {
      lent.done(outcome.evict);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const lent = await this.lend();
    let evict = false;
    try {
      const result = await run(lent.connection, request);
      return { affectedRows: isResultSetHeader(result) ? result.affectedRows : 0 };
    } catch (error) {
      evict = isFatal(error instanceof Error && error.cause !== undefined ? error.cause : error);
      throw error;
    } finally {
      lent.done(evict);
    }
  }
}

function lendHeld(connection: PoolConnection): Lent {
  return { connection, onEarlyExit: 'drain', done: () => {} };
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
    await runConstant(this.#connection, 'START TRANSACTION');
    return new MysqlTransactionImpl(this.#connection);
  }

  async release(): Promise<void> {
    this.#connection.release();
    this.#giveBack();
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
    await this.execute({ sql: 'COMMIT' });
  }

  async rollback(): Promise<void> {
    await this.execute({ sql: 'ROLLBACK' });
  }
}

/** A connection from `pool`, or `DRIVER.CONNECTION_FAILED` once `timeoutMs` passes without one; a connection that arrives later goes back to the pool. */
function waitForConnection(pool: Pool, timeoutMs: number): Promise<PoolConnection> {
  return new Promise<PoolConnection>((resolve, reject) => {
    let waiting = true;
    const timer = setTimeout(() => {
      waiting = false;
      reject(
        errorRuntime(
          'DRIVER.CONNECTION_FAILED',
          'Timed out waiting for a pooled MySQL connection',
          {
            why: `No connection was free within ${timeoutMs} ms; every connection in the pool was in use.`,
            fix: 'Release held connections sooner, or raise connectionLimit or poolTimeout in the URL.',
            meta: { poolTimeoutMs: timeoutMs },
          },
        ),
      );
    }, timeoutMs);
    pool.getConnection((error, acquired) => {
      clearTimeout(timer);
      if (!waiting) {
        if (!error) acquired.release();
        return;
      }
      if (error) reject(normalizeMysqlError(error));
      else resolve(acquired);
    });
  });
}

type DriverState =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'connected'; readonly pool: Pool; readonly poolTimeoutMs: number }
  | { readonly kind: 'closed' };

/**
 * The MySQL runtime driver: a mysql2 pool that runs every statement as a server-side prepared statement, so a value never travels inside the SQL. Each connection keeps a bounded cache of prepared statements (`statementCacheSize`) and closes the ones it drops. Each physical connection runs the session setup once, before its first statement, and goes back to the pool after each statement; a broken connection is destroyed. `close()` waits for every connection and stream it has handed out before it ends the pool.
 */
export class MysqlDriver extends MysqlQueryable implements MysqlRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;

  #state: DriverState = { kind: 'unbound' };
  readonly #leases = new Leases();
  readonly #setUp = new WeakSet<PoolConnection>();

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  async connect(binding: MysqlBinding): Promise<void> {
    if (this.#state.kind === 'connected') {
      throw errorRuntime('DRIVER.ALREADY_CONNECTED', 'MySQL driver already connected', {
        fix: 'Call close() before connecting again.',
      });
    }
    const { connectionLimit, poolTimeoutMs, statementCacheSize } = mysqlPoolSettings(binding.url);
    const pool = createPool({
      ...mysqlConnectionOptions(binding.url),
      maxPreparedStatements: statementCacheSize,
      ...ifDefined('connectionLimit', connectionLimit),
    });
    this.#state = { kind: 'connected', pool, poolTimeoutMs };
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
        onEarlyExit: 'evict',
        done: (evict) => {
          if (evict) connection.destroy();
          else connection.release();
          giveBack();
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
    await new Promise<void>((resolve) => pool.end(() => resolve()));
  }

  async #acquire(): Promise<PoolConnection> {
    if (this.#state.kind !== 'connected') {
      throw notConnected(
        this.#state.kind === 'closed' ? 'MySQL driver is closed' : 'MySQL driver not connected',
      );
    }
    const connection = await waitForConnection(this.#state.pool, this.#state.poolTimeoutMs);
    if (this.#setUp.has(connection)) return connection;
    try {
      await setUpSession(connection);
    } catch (error) {
      connection.destroy();
      throw normalizeMysqlError(error);
    }
    this.#setUp.add(connection);
    return connection;
  }
}
