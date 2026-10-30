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
import { acquireClientQueryLock } from '../client-query-lock';
import { type MysqlPoolOptions, mysqlPoolOptions } from '../connection-options';
import { connectingCannotSucceed, isFatal, normalizeMysqlError } from '../normalize-error';
import { SessionSettingsGuard } from '../session-settings';
import { statementFor } from '../statement';
import { Canceller } from './canceller';

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

/** Runs `request` on `client` in one round trip and returns its result: its `?N` placeholders written as `?`, and its values handed to the package, which writes them into the statement. Throws the package's error as it is. */
async function run(client: PoolConnection, request: SqlExecuteRequest): Promise<unknown> {
  const { sql, values } = statementFor(client, request.sql, request.params ?? []);
  return client.query(sql, values);
}

/** Starts streaming the rows of `request` on `client`, sent as {@link run} sends it. Throws the error to report, after noting in `outcome` whether it left the client unusable. */
function startStream(
  client: PoolConnection,
  request: SqlExecuteRequest,
  outcome: Outcome,
): Readable {
  try {
    const { sql, values } = statementFor(client, request.sql, request.params ?? []);
    return client.queryStream(sql, values);
  } catch (error) {
    throw settle(error, outcome);
  }
}

/** What a statement's result reports: the rows it changed, and, when it changed one row, the value MySQL numbered for it. MySQL reports 0 when it numbered none. */
function statementStats(result: unknown): SqlStatementStats {
  if (typeof result !== 'object' || result === null) return { affectedRows: 0 };
  const affectedRows =
    'affectedRows' in result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
  const insertId = 'insertId' in result ? result.insertId : undefined;
  return affectedRows === 1 &&
    (typeof insertId === 'bigint' || typeof insertId === 'number') &&
    insertId > 0
    ? { affectedRows, insertId: String(insertId) }
    : { affectedRows };
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

/**
 * Reads and drops what is left of a stream's result. The package's `close()` stops it keeping new rows; the rows already buffered are read here with `read()`, which works whether or not the caller's iterator is still attached to the stream, so an iterator the caller abandoned cannot hold the drain up.
 */
async function dropRest(rows: Readable & { close?: () => void }): Promise<void> {
  rows.close?.();
  const drain = () => {
    while (rows.read() !== null) {}
  };
  rows.on('readable', drain);
  try {
    drain();
    await finished(rows);
  } finally {
    rows.off('readable', drain);
  }
}

function connectionReleased() {
  return errorRuntime('DRIVER.NOT_CONNECTED', 'MySQL connection was released', {
    fix: 'Send statements on a connection only until you release it, and await each one before release().',
  });
}

/** The package can report an error on a stream after the caller stopped reading it, such as MySQL's for a statement the driver cancelled; the generator has already settled by then. */
function ignoreAfterStop(): void {}

/**
 * Cancels the statement running on a connection, by its MySQL thread id, from another connection: MySQL cannot cancel a statement on its own connection. Resolves whether the cancel was sent. Never rejects.
 */
type CancelStatement = (threadId: number | null) => Promise<boolean>;

/** MySQL's error for a statement `KILL QUERY` cancelled (`ER_QUERY_INTERRUPTED`). The package marks it fatal when it arrives in the middle of a result, but the connection stays usable. */
function isQueryInterrupted(error: unknown): boolean {
  return error instanceof Error && 'errno' in error && error.errno === 1317;
}

abstract class MysqlQueryable implements SqlQueryable {
  protected abstract acquireClient(): Promise<PoolConnection>;
  protected abstract releaseClient(client: PoolConnection, outcome: Outcome): Promise<void>;
  /** Whether the caller holds the client, so its session must survive a stream the caller stops early. */
  protected abstract readonly holdsClient: boolean;
  protected abstract readonly cancelStatement: CancelStatement;

  constructor(protected readonly streams: boolean) {}

  /** Records a stream that is open, and returns the call that records its end. */
  protected streamOpened(_rows: Readable): () => void {
    return () => {};
  }

  /** Takes the client's lock, which keeps statements on it one at a time in the order sent. */
  protected lockClient(client: PoolConnection): Promise<() => void> {
    return acquireClientQueryLock(client);
  }

  /** Runs one statement that is not a stream, under the client's lock. */
  protected runStatement<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }

  /** Whether the client went back to the pool under this queryable, so it must send nothing more on it. */
  protected get handedBack(): boolean {
    return false;
  }

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
    return statementStats(await this.#runReleasing(request));
  }

  async #runReleasing(request: SqlExecuteRequest): Promise<unknown> {
    const client = await this.acquireClient();
    const outcome: Outcome = { destroy: false };
    try {
      const releaseLock = await this.lockClient(client);
      try {
        return await this.runStatement(() => run(client, request));
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
    let releaseLock: () => void;
    try {
      releaseLock = await this.lockClient(client);
    } catch (error) {
      await this.releaseClient(client, outcome);
      throw error;
    }
    try {
      const rows = startStream(client, request, outcome);
      rows.on('error', ignoreAfterStop);
      const streamClosed = this.streamOpened(rows);
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
        if (!settled && !this.handedBack) await this.#stopEarly(client, rows, outcome);
        if (outcome.destroy) rows.destroy();
        streamClosed();
      }
    } finally {
      releaseLock();
      await this.releaseClient(client, outcome);
    }
  }

  /**
   * Ends a stream the caller stopped reading early, and keeps the client usable. While its result is still arriving, the statement is first cancelled with `KILL QUERY`, so a large result is not downloaded only to be thrown away; MySQL does not say how many rows remain. On a held connection or in a transaction, as on a pooled one: `KILL QUERY` ends only the statement, the session survives, and in a transaction MySQL rolls back only that statement. The rest of the result is then read and dropped, MySQL's error for the cancelled statement among it. The client is never destroyed while its statement runs: the package's `destroy()` would send `KILL` itself, on a connection whose failure it does not handle.
   */
  async #stopEarly(client: PoolConnection, rows: Readable, outcome: Outcome): Promise<void> {
    const cancelled = !resultReceived(rows) && (await this.cancelStatement(client.threadId));
    await dropRest(rows).catch((error: unknown) => {
      if (isFatal(error) && !(cancelled && isQueryInterrupted(error))) outcome.destroy = true;
    });
  }
}

/** The state of a held connection, shared by the connection and its transactions as the Postgres driver shares its transaction state. */
interface HeldState {
  /** The streams open on the client, which a release or destroy cancels and reads to their end. */
  readonly streams: Set<Readable>;
  /** The statements that are not streams and hold the client's lock, which a release lets finish. */
  readonly running: Set<Promise<unknown>>;
  readonly cancel: CancelStatement;
  /** Settles once the connection is released or destroyed, which refuses every statement sent or still waiting for the client's lock. */
  readonly handedBack: { done: boolean; readonly signal: Promise<never>; refuse(): void };
}

function handedBackState(): HeldState['handedBack'] {
  let refuse: () => void = () => {};
  const signal = new Promise<never>((_, reject) => {
    refuse = () => reject(connectionReleased());
  });
  signal.catch(() => undefined);
  const state = {
    done: false,
    signal,
    refuse: () => {
      state.done = true;
      refuse();
    },
  };
  return state;
}

/**
 * A queryable on a connection the caller holds, whose statements all run on the same session, in the order they are sent, under the client's lock. A statement sent while a stream on the connection is open waits for that stream to end; one awaited inside the stream's own loop never finishes, as on Postgres with a cursor.
 */
abstract class MysqlHeldQueryable extends MysqlQueryable {
  protected readonly holdsClient = true;

  protected get cancelStatement(): CancelStatement {
    return this.held.cancel;
  }

  protected override streamOpened(rows: Readable): () => void {
    this.held.streams.add(rows);
    return () => this.held.streams.delete(rows);
  }

  protected override get handedBack(): boolean {
    return this.held.handedBack.done;
  }

  /** Takes the client's lock, or fails once the connection is handed back, whether the statement was sent after that or was still waiting for the lock. A lock taken after that is given straight back. */
  protected override async lockClient(client: PoolConnection): Promise<() => void> {
    if (this.held.handedBack.done) throw connectionReleased();
    const locking = acquireClientQueryLock(client);
    try {
      const releaseLock = await Promise.race([locking, this.held.handedBack.signal]);
      if (!this.held.handedBack.done) return releaseLock;
      releaseLock();
    } catch {
      void locking.then((releaseLock) => releaseLock());
    }
    throw connectionReleased();
  }

  protected override runStatement<T>(work: () => Promise<T>): Promise<T> {
    const running = work();
    this.held.running.add(running);
    void running.then(
      () => this.held.running.delete(running),
      () => this.held.running.delete(running),
    );
    return running;
  }

  constructor(
    protected readonly client: PoolConnection,
    protected readonly held: HeldState,
    streams: boolean,
  ) {
    super(streams);
  }

  protected async acquireClient(): Promise<PoolConnection> {
    if (this.held.handedBack.done) throw connectionReleased();
    return this.client;
  }

  protected async releaseClient(): Promise<void> {}

  /** Runs one of the package's transaction calls under the client's lock, taken as a statement takes it, so it keeps its place among the statements sent. */
  protected async underLock(call: () => Promise<void>): Promise<void> {
    const client = await this.acquireClient();
    const releaseLock = await this.lockClient(client);
    try {
      await this.runStatement(call);
    } catch (error) {
      throw normalizeMysqlError(error);
    } finally {
      releaseLock();
    }
  }
}

class MysqlConnectionImpl extends MysqlHeldQueryable implements SqlConnection {
  #onRelease: (() => void) | undefined;

  constructor(
    client: PoolConnection,
    streams: boolean,
    cancel: CancelStatement,
    onRelease: () => void,
  ) {
    super(
      client,
      { streams: new Set(), running: new Set(), cancel, handedBack: handedBackState() },
      streams,
    );
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
   * Returns the connection to the pool, as the Postgres driver's `release()` does. From then on the connection refuses every statement, those still waiting for its lock included, so none runs later in another caller's session. A statement that is not a stream and is already running finishes, as on Postgres. A stream still open, such as one the caller dropped, is cancelled and read to its end by the driver: the package's release sends `ROLLBACK` behind that statement and waits for it, which would otherwise never finish, where `pg`'s release does not wait on the server.
   */
  async release(): Promise<void> {
    if (this.held.handedBack.done) return;
    this.held.handedBack.refuse();
    try {
      if (this.held.streams.size > 0) await this.#cancelRunning();
      await this.#runningSettled();
      await this.client.release();
    } finally {
      this.#released();
    }
  }

  /** Closes the connection instead of returning it. It refuses every statement from then on, cancels whatever still runs and waits for it to end, so the package's `destroy()` never sends a `KILL` of its own. */
  async destroy(_reason?: unknown): Promise<void> {
    if (this.held.handedBack.done) return;
    this.held.handedBack.refuse();
    try {
      if (this.held.streams.size > 0 || this.held.running.size > 0) await this.#cancelRunning();
      await this.#runningSettled();
      await this.client.ping().catch(() => undefined);
      this.client.destroy();
    } finally {
      this.#released();
    }
  }

  async #cancelRunning(): Promise<void> {
    await this.held.cancel(this.client.threadId);
    await Promise.all([...this.held.streams].map((rows) => dropRest(rows).catch(() => undefined)));
  }

  async #runningSettled(): Promise<void> {
    await Promise.allSettled([...this.held.running]);
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
 * The MySQL runtime driver: a `mariadb` pool. Every statement takes one round trip over the text protocol, the package writing its values into it. A query reads its whole result before the first row unless `stream` is set. The pool runs the session setup once on each physical connection, and the driver then sets the target's session settings on it; a connection goes back to the pool after each statement as it is; a broken connection is destroyed. `close()` waits for every connection and stream it has handed out before it ends the pool.
 */
export class MysqlDriver extends MysqlQueryable implements MysqlRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;
  protected readonly holdsClient = false;

  #state: DriverState = { kind: 'unbound' };
  readonly #inUse = new ClientsInUse();
  #canceller: Canceller | undefined;
  protected readonly cancelStatement: CancelStatement = (threadId) =>
    this.#canceller?.cancel(threadId) ?? Promise.resolve(false);
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
    this.#canceller = new Canceller(binding.url);
  }

  async acquireConnection(): Promise<SqlConnection> {
    const client = await this.acquireClient();
    return new MysqlConnectionImpl(client, this.streams, this.cancelStatement, () =>
      this.#inUse.released(),
    );
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { pool } = this.#state;
    this.#state = { kind: 'closed' };
    await this.#inUse.none();
    await this.#canceller?.close();
    this.#canceller = undefined;
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

  /**
   * Destroys a client only after an error the package marks fatal. The package marks an error fatal when the connection's socket is gone or can no longer be trusted, and it has then already set the connection closed and failed every command on it (`fatalError` in its `connection.js`), so no command is receiving and its `destroy()` sends no `KILL`. A statement the caller stopped early is cancelled and read to its end instead (`#stopEarly`).
   */
  protected async releaseClient(client: PoolConnection, { destroy }: Outcome): Promise<void> {
    try {
      if (destroy) client.destroy();
      else await client.release();
    } finally {
      this.#inUse.released();
    }
  }
}
