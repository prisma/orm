import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { errorRuntime } from '@internal/errors/execution';
import type { SessionSettings } from '@internal/framework-components/components';
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
import { createPool, type Pool, type PoolConnection } from 'mariadb';
import { type MysqlPoolOptions, mysqlPoolOptions } from '../connection-options';
import { connectingCannotSucceed, isFatal, normalizeMysqlError } from '../normalize-error';
import { assertPlaceholderCount } from '../placeholder-count';
import { positionalParams } from '../positional-params';
import { SessionSettingsGuard } from '../session-settings';

/** Where the runtime driver connects: a `mysql://` URL. */
export type MysqlBinding = { readonly kind: 'url'; readonly url: string };

export type MysqlRuntimeDriver = RuntimeDriverInstance<'sql', 'mysql'> & SqlDriver<MysqlBinding>;

export interface MysqlDriverCreateOptions {
  /** Stream each query's rows as they arrive, instead of reading the whole result before the first row, which is the default, as on Postgres without a cursor. */
  readonly stream?: boolean | undefined;
  readonly poolOptions?: MysqlPoolOptions | undefined;
  /** The session settings the stack's target declares, which every connection starts with. */
  readonly sessionSettings?: SessionSettings | undefined;
}

function notConnected(message: string) {
  return errorRuntime('DRIVER.NOT_CONNECTED', message, {
    fix: 'Call connect(binding) before running queries, and do not use the driver after close().',
  });
}

class AsyncMutex {
  #queue = Promise.resolve();

  async lock(): Promise<() => void> {
    const previous = this.#queue;
    let releaseLock: (() => void) | undefined;
    this.#queue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await previous;
    return () => {
      releaseLock?.();
      releaseLock = undefined;
    };
  }
}

/**
 * One statement at a time on each client, in the order sent, as the Postgres driver's per-client lock runs them. The lock is held until the statement settles, or for a stream's whole life. The package queues a prepared statement's execution only after MySQL answers the prepare, so without the lock a commit sent meanwhile would run first.
 */
const clientQueryLocks = new WeakMap<object, AsyncMutex>();

function acquireClientQueryLock(client: object): Promise<() => void> {
  let mutex = clientQueryLocks.get(client);
  if (mutex === undefined) {
    mutex = new AsyncMutex();
    clientQueryLocks.set(client, mutex);
  }
  return mutex.lock();
}

/**
 * Runs `request` on `client` and returns its result. A statement with values runs as a server-side prepared statement, its `?N` placeholders written as `?`, after checking MySQL's placeholder count against the values. A statement without values runs over the text protocol, as `pg` runs one: nothing is written into it, so a raw `START TRANSACTION` or `LOCK TABLES`, which MySQL does not prepare, runs too. Throws the package's error as it is.
 */
async function run(client: PoolConnection, request: SqlExecuteRequest): Promise<unknown> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  if (values.length === 0) return client.query(sql);
  const statement = await client.prepare(sql);
  try {
    assertPlaceholderCount(statement, values.length);
    return await statement.execute(values);
  } finally {
    statement.close();
  }
}

/** Starts streaming the rows of `request` on `client`, prepared when it has values and over the text protocol when it has none, as {@link run} runs it. `close` closes the prepared statement, if any. Throws the package's error as it is. */
async function startStream(
  client: PoolConnection,
  request: SqlExecuteRequest,
): Promise<{ readonly rows: Readable; readonly close: () => void }> {
  const { sql, values } = positionalParams(request.sql, request.params ?? []);
  if (values.length === 0) return { rows: client.queryStream(sql), close: () => {} };
  const statement = await client.prepare(sql);
  try {
    assertPlaceholderCount(statement, values.length);
    return { rows: statement.executeStream(values), close: () => statement.close() };
  } catch (error) {
    statement.close();
    throw error;
  }
}

function affectedRows(result: unknown): number {
  return typeof result === 'object' &&
    result !== null &&
    'affectedRows' in result &&
    typeof result.affectedRows === 'number'
    ? result.affectedRows
    : 0;
}

/** What a statement reports back to whoever released its client: whether the client may be broken and must be destroyed. */
interface Outcome {
  destroy: boolean;
}

/** The error to report for `error`, after noting in `outcome` whether it left the client unusable. */
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

/** The package can report an error on a stream after the caller stopped reading it, such as the one for a connection destroyed mid-result; the generator has already settled by then. */
function ignoreAfterStop(): void {}

abstract class MysqlQueryable implements SqlQueryable {
  protected abstract acquireClient(): Promise<PoolConnection>;
  protected abstract releaseClient(client: PoolConnection, outcome: Outcome): Promise<void>;
  /** Whether the caller holds the client, so its session must survive a stream the caller stops early. */
  protected abstract readonly holdsClient: boolean;

  constructor(protected readonly streams: boolean) {}

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    if (this.streams) {
      yield* this.#streamRows<Row>(request);
      return;
    }
    const result = await this.#runReleasing(request);
    for (const row of Array.isArray(result) ? result : []) {
      yield blindCast<
        Row,
        'the package returns the rows the statement produces, shaped by the query'
      >(row);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    return { affectedRows: affectedRows(await this.#runReleasing(request)) };
  }

  async #runReleasing(request: SqlExecuteRequest): Promise<unknown> {
    const client = await this.acquireClient();
    const outcome: Outcome = { destroy: false };
    try {
      const releaseLock = await acquireClientQueryLock(client);
      try {
        return await run(client, request);
      } finally {
        releaseLock();
      }
    } catch (error) {
      throw settle(error, outcome);
    } finally {
      await this.releaseClient(client, outcome);
    }
  }

  /**
   * Streams the rows of `request` as they arrive; the package pauses the socket while the caller is busy. A caller that stops reading early is handled by {@link MysqlQueryable.#stopEarly}. A fatal error, such as a lost connection, destroys the client.
   */
  async *#streamRows<Row>(request: SqlExecuteRequest): AsyncGenerator<Row> {
    const client = await this.acquireClient();
    const outcome: Outcome = { destroy: false };
    const releaseLock = await acquireClientQueryLock(client);
    try {
      const stream = await startStream(client, request).catch((error: unknown) => {
        throw settle(error, outcome);
      });
      stream.rows.on('error', ignoreAfterStop);
      let settled = false;
      try {
        for await (const row of stream.rows.iterator({ destroyOnReturn: false })) {
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
        if (!settled) await this.#stopEarly(stream.rows, outcome);
        if (outcome.destroy) stream.rows.destroy();
        else stream.close();
      }
    } finally {
      releaseLock();
      await this.releaseClient(client, outcome);
    }
  }

  /**
   * Ends a stream the caller stopped reading early. Once the whole result has arrived, or on a held client whose session must survive, the rest is read and dropped and the client stays usable. A pooled client whose result is still arriving is destroyed instead, so a large result is not downloaded only to be thrown away; MySQL does not say how many rows remain. Destroying it mid-result makes the package open one short-lived extra connection to send `KILL`, because MySQL cannot cancel a statement on its own connection.
   */
  async #stopEarly(rows: Readable, outcome: Outcome): Promise<void> {
    if (!this.holdsClient && !resultReceived(rows)) {
      outcome.destroy = true;
      return;
    }
    await dropRest(rows).catch((error: unknown) => {
      if (isFatal(error)) outcome.destroy = true;
    });
  }
}

/** The state of a held connection, shared by the connection and its transactions as the Postgres driver shares its transaction state. */
interface HeldState {
  /** How many statements are running or waiting for the client's lock; a stream the caller dropped without finishing it stays running. */
  running: number;
}

/**
 * A queryable on a connection the caller holds, whose statements all run on the same session, in the order they are sent, under the client's lock. A statement sent while a stream on the connection is open waits for that stream to end; one awaited inside the stream's own loop never finishes, as on Postgres with a cursor.
 */
abstract class MysqlHeldQueryable extends MysqlQueryable {
  protected readonly holdsClient = true;

  constructor(
    protected readonly client: PoolConnection,
    protected readonly held: HeldState,
    streams: boolean,
  ) {
    super(streams);
  }

  protected async acquireClient(): Promise<PoolConnection> {
    this.held.running += 1;
    return this.client;
  }

  protected async releaseClient(): Promise<void> {
    this.held.running -= 1;
  }

  /** Runs one of the package's transaction calls under the client's lock, taken as a statement takes it, so it keeps its place among the statements sent. */
  protected async underLock(call: () => Promise<void>): Promise<void> {
    const client = await this.acquireClient();
    try {
      const releaseLock = await acquireClientQueryLock(client);
      try {
        await call();
      } finally {
        releaseLock();
      }
    } catch (error) {
      throw normalizeMysqlError(error);
    } finally {
      await this.releaseClient();
    }
  }
}

class MysqlConnectionImpl extends MysqlHeldQueryable implements SqlConnection {
  #onRelease: (() => void) | undefined;

  constructor(client: PoolConnection, streams: boolean, onRelease: () => void) {
    super(client, { running: 0 }, streams);
    this.#onRelease = onRelease;
  }

  #released(): void {
    const onRelease = this.#onRelease;
    this.#onRelease = undefined;
    onRelease?.();
  }

  async beginTransaction(): Promise<SqlTransaction> {
    await this.underLock(() => this.client.beginTransaction());
    return new MysqlTransactionImpl(this.client, this.held, this.streams);
  }

  /**
   * Returns the connection to the pool, as the Postgres driver's `release()` does. A connection with a statement still running, such as a stream the caller dropped, is destroyed instead: the package's release sends `ROLLBACK` behind that statement and waits for it, which would never finish, where `pg`'s release does not wait on the server.
   */
  async release(): Promise<void> {
    if (this.held.running > 0) return this.destroy();
    try {
      await this.client.release();
    } finally {
      this.#released();
    }
  }

  async destroy(_reason?: unknown): Promise<void> {
    this.client.destroy();
    this.#released();
  }
}

class MysqlTransactionImpl extends MysqlHeldQueryable implements SqlTransaction {
  async commit(): Promise<void> {
    await this.underLock(() => this.client.commit());
  }

  async rollback(): Promise<void> {
    await this.underLock(() => this.client.rollback());
  }
}

/** How many clients the driver has handed out and not had back, a held connection or one lent to a single statement, so `close()` can wait until every one is back. */
class ClientsInUse {
  #count = 0;
  #idle: (() => void)[] = [];

  acquired(): void {
    this.#count += 1;
  }

  released(): void {
    this.#count -= 1;
    if (this.#count === 0) for (const resolve of this.#idle.splice(0)) resolve();
  }

  none(): Promise<void> {
    return this.#count === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.#idle.push(resolve));
  }
}

/** The pool reports a connection it failed to open on its `'error'` event, and again as the cause of a `getConnection` that times out; the driver reports it there. */
function ignoreConnectionFailure(): void {}

/**
 * The statements waiting for a connection from the pool. The pool keeps retrying a connection it cannot open, with a growing pause between attempts, and fails a waiting `getConnection` only when `connectionTimeoutMillis` ends; the package reports each failure to its `logger.error` as it happens, together with every failed statement. `pg.Pool` instead rejects a pending connect whose connection fails, at once. So the driver fails the waiting statements at once with a failure no retry can get past. It keeps no failure: a later statement waits for the pool's next attempt.
 */
class WaitingForConnection {
  readonly #fail = new Set<(error: unknown) => void>();

  async race(getting: Promise<PoolConnection>): Promise<PoolConnection> {
    let fail: (error: unknown) => void = () => {};
    const failed = new Promise<never>((_, reject) => {
      fail = reject;
    });
    this.#fail.add(fail);
    try {
      return await Promise.race([getting, failed]);
    } finally {
      this.#fail.delete(fail);
    }
  }

  /** Reacts to an error the package reports: only a failure to connect, which the package marks fatal, that no retry can get past. A statement can fail with the same error number, such as 1524 for a missing authentication plugin, but not fatally. */
  reported(error: unknown): void {
    if (!isFatal(error) || !connectingCannotSucceed(error)) return;
    for (const fail of this.#fail) fail(error);
    this.#fail.clear();
  }
}

/** Gives a connection the pool hands over after its statement stopped waiting back to the pool. */
function releaseLate(getting: Promise<PoolConnection>): void {
  getting.then((late) => late.release(), ignoreConnectionFailure).catch(ignoreConnectionFailure);
}

type DriverState =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'connected'; readonly pool: Pool; readonly waiting: WaitingForConnection }
  | { readonly kind: 'closed' };

/**
 * The MySQL runtime driver: a `mariadb` pool. A statement with values runs as a server-side prepared statement, so a value never travels inside the SQL. A query reads its whole result before the first row unless `stream` is set. The pool runs the session setup once on each physical connection, and the driver then sets the target's session settings on it with a prepared statement; a connection goes back to the pool after each statement as it is; a broken connection is destroyed. `close()` waits for every connection and stream it has handed out before it ends the pool.
 */
export class MysqlDriver extends MysqlQueryable implements MysqlRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;
  protected readonly holdsClient = false;

  #state: DriverState = { kind: 'unbound' };
  readonly #inUse = new ClientsInUse();
  readonly #options: MysqlDriverCreateOptions;
  readonly #sessionSettings: SessionSettingsGuard;

  constructor(options: MysqlDriverCreateOptions = {}) {
    super(options.stream ?? false);
    this.#options = options;
    this.#sessionSettings = new SessionSettingsGuard(options.sessionSettings ?? {});
  }

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  async connect(binding: MysqlBinding): Promise<void> {
    if (this.#state.kind === 'connected') {
      throw errorRuntime('DRIVER.ALREADY_CONNECTED', 'MySQL driver already connected', {
        fix: 'Call close() before connecting again.',
      });
    }
    const waiting = new WaitingForConnection();
    const pool = createPool({
      ...mysqlPoolOptions(binding.url, this.#options.poolOptions),
      logger: { error: (error) => waiting.reported(error) },
    });
    if (pool instanceof EventEmitter) pool.on('error', ignoreConnectionFailure);
    this.#state = { kind: 'connected', pool, waiting };
  }

  async acquireConnection(): Promise<SqlConnection> {
    const client = await this.acquireClient();
    return new MysqlConnectionImpl(client, this.streams, () => this.#inUse.released());
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { pool } = this.#state;
    this.#state = { kind: 'closed' };
    await this.#inUse.none();
    await pool.end();
  }

  protected async acquireClient(): Promise<PoolConnection> {
    if (this.#state.kind !== 'connected') {
      throw notConnected(
        this.#state.kind === 'closed' ? 'MySQL driver is closed' : 'MySQL driver not connected',
      );
    }
    const { pool, waiting } = this.#state;
    this.#inUse.acquired();
    const getting = pool.getConnection();
    let client: PoolConnection;
    try {
      client = await waiting.race(getting);
    } catch (error) {
      releaseLate(getting);
      this.#inUse.released();
      throw normalizeMysqlError(error);
    }
    try {
      await this.#sessionSettings.ensure(client);
    } catch (error) {
      client.destroy();
      this.#inUse.released();
      throw normalizeMysqlError(error);
    }
    return client;
  }

  protected async releaseClient(client: PoolConnection, { destroy }: Outcome): Promise<void> {
    try {
      if (destroy) client.destroy();
      else await client.release();
    } finally {
      this.#inUse.released();
    }
  }
}
