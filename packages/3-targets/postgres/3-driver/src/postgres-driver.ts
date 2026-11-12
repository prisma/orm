import type { SessionSettings } from '@internal/framework-components/components';
import { SqlQueryError } from '@internal/sql-errors';
import type {
  PreparedStatementHandle,
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
  SqlTransactionOptions,
} from '@internal/sql-relational-core/ast';
import { validatePostgresIsolationLevel } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
import type {
  Client,
  ClientBase,
  QueryResult as PgQueryResult,
  PoolClient,
  Pool as PoolType,
  QueryConfig,
  QueryResultRow,
} from 'pg';
import Cursor from 'pg-cursor';
import { callbackToPromise } from './callback-to-promise';
import { type DriverRuntimeError, driverError } from './driver-error';
import { NamedCursor } from './named-cursor';
import {
  isPostgresError,
  normalizePgClientError,
  normalizePgConnectFailure,
} from './normalize-error';
import {
  hasLostConnection,
  hasStartedConnecting,
  markClientAbandoned,
  watchClientLoss,
} from './pg-client-state';
import { serverTextTypes } from './server-text-types';
import { createPgPool, SessionSettingsGuard } from './session-settings';

export type QueryResult<T extends QueryResultRow = QueryResultRow> = PgQueryResult<T>;

/**
 * Concurrency contract: the driver serializes queries per physical client, so
 * overlapping calls on a `pgClient` binding, a pinned connection, or a
 * transaction handle run strictly sequentially in FIFO order. Pool bindings
 * run each driver-level call on its own pool client and are unaffected.
 *
 * Lock lifetime: buffered execution (cursors disabled) locks the client only
 * while fetching; row iteration is lock-free, so a nested query on the same
 * client inside `for await` works. Cursor-enabled streams hold the lock for
 * the stream's entire lifetime — a nested query on the same client inside
 * stream iteration deadlocks, exactly as under pg@8's queue.
 */
export type PostgresBinding =
  | { readonly kind: 'url'; readonly url: string }
  | {
      readonly kind: 'pgPool';
      readonly pool: PoolType;
      /** Whether the driver ends the pool on close. False for a pool the caller supplied. */
      readonly ownedByDriver: boolean;
    }
  | {
      readonly kind: 'pgClient';
      readonly client: Client;
      /** Whether the driver ends the client on close. False for a client the caller supplied. */
      readonly ownedByDriver: boolean;
    };

export interface PostgresCursorOptions {
  readonly batchSize?: number;
  readonly disabled?: boolean;
}

interface PostgresDriverOptions {
  readonly connect:
    | { readonly client: Client; readonly ownedByDriver: boolean }
    | { readonly pool: PoolType; readonly ownedByDriver: boolean };
  readonly cursor?: PostgresCursorOptions | undefined;
  /**
   * Use server-side prepared statements for `query()` requests with a
   * prepared-statement handle. Default
   * `true`. Set `false` when running behind a transaction-mode pooler that
   * does not support session-scoped prepared statements (e.g. PgBouncer
   * transaction mode).
   */
  readonly preparedStatements?: boolean | undefined;
  /** The session settings the stack's target declares, which the driver ensures on every connection it uses. */
  readonly sessionSettings?: SessionSettings | undefined;
}

export type PostgresDriverCreateOptions = Omit<PostgresDriverOptions, 'connect'>;

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PREPARED_STATEMENTS = true;

type CursorOptions =
  | { readonly cursorDisabled: true }
  | { readonly cursorBatchSize: number; readonly cursorDisabled: false };

interface HandleAllocator {
  mint(): string;
}

function createHandleAllocator(): HandleAllocator {
  // Driver-scoped so a single PreparedStatement reused across multiple
  // Connections/Transactions of the same driver always sees one handle.
  let next = 1;
  return {
    mint: () => `pn_${next++}`,
  };
}

type ConnectionOptions = CursorOptions & {
  readonly preparedStatementsEnabled: boolean;
  readonly handleAllocator: HandleAllocator;
};

function buildConnectionOptions(options: PostgresDriverOptions): ConnectionOptions {
  const cursorOptions: CursorOptions = options.cursor?.disabled
    ? { cursorDisabled: true }
    : {
        cursorBatchSize: options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE,
        cursorDisabled: false,
      };
  return {
    ...cursorOptions,
    preparedStatementsEnabled: options.preparedStatements ?? DEFAULT_PREPARED_STATEMENTS,
    handleAllocator: createHandleAllocator(),
  };
}

/** Reads the normalized error that runExecute and runQuery throw; a raw pg error is never stale. */
function isStalePreparedStatementError(error: unknown): boolean {
  if (!SqlQueryError.is(error)) {
    return false;
  }
  const code = error.sqlState;
  // 26000 — invalid_sql_statement_name (server lost the named statement,
  //         e.g. after DEALLOCATE ALL).
  // 0A000 — cached plan invalidated by DDL (row shape changed).
  return code === '26000' || code === '0A000';
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

// One query in flight per physical client: pg@9 removes pg@8's internal query
// queue and throws when a query is sent while another is running, so the
// driver owns FIFO serialization. Held for exactly as long as the client is
// busy: a buffered fetch or transaction boundary statement locks only its own
// await, while a cursor stream span locks BEGIN…COMMIT wholesale (the cursor
// occupies the connection for its entire lifetime), which also keeps
// concurrent streams on a shared client from interleaving their wraps.
const clientQueryLocks = new WeakMap<object, AsyncMutex>();
const clientStreams = new WeakMap<object, Set<() => Promise<void>>>();
const clientEndListeners = new WeakMap<ClientBase, Set<() => void>>();

function clientEnded(client: ClientBase): void {
  const listeners = clientEndListeners.get(client);
  for (const listener of listeners ?? []) listener();
  listeners?.clear();
}

function observeClientEnd(client: ClientBase, ended: () => void): () => void {
  let listeners = clientEndListeners.get(client);
  if (listeners === undefined) {
    listeners = new Set();
    clientEndListeners.set(client, listeners);
    client.on('end', () => clientEnded(client));
  }
  listeners.add(ended);
  return () => {
    listeners.delete(ended);
  };
}

function registerClientStream(client: ClientBase, close: () => Promise<void>): () => void {
  let streams = clientStreams.get(client);
  if (streams === undefined) {
    streams = new Set();
    clientStreams.set(client, streams);
  }
  streams.add(close);
  return () => {
    streams.delete(close);
  };
}

async function drainClientStreams(client: ClientBase): Promise<void> {
  await Promise.all([...(clientStreams.get(client) ?? [])].map((close) => close()));
}

function acquireClientQueryLock(client: ClientBase): Promise<() => void> {
  let mutex = clientQueryLocks.get(client);
  if (mutex === undefined) {
    mutex = new AsyncMutex();
    clientQueryLocks.set(client, mutex);
  }
  return mutex.lock();
}

class ConnectionLease {
  active = true;
  readonly #streams = new Set<() => Promise<void>>();

  assertActive(): void {
    if (!this.active)
      throw driverError('DRIVER.NOT_CONNECTED', 'Postgres connection lease has ended.');
  }

  register(close: () => Promise<void>): () => void {
    this.assertActive();
    this.#streams.add(close);
    return () => {
      this.#streams.delete(close);
    };
  }

  async drain(): Promise<void> {
    this.active = false;
    await this.closeStreams();
  }

  async closeStreams(): Promise<void> {
    await Promise.all([...this.#streams].map((close) => close()));
  }
}

abstract class PostgresQueryable<C extends PoolClient | Client = PoolClient | Client>
  implements SqlQueryable
{
  abstract acquireClient(): Promise<C>;
  abstract releaseClient(client: C): Promise<void>;

  protected readonly options: ConnectionOptions;

  constructor(
    options: ConnectionOptions,
    protected readonly lease?: ConnectionLease,
  ) {
    this.options = options;
  }

  protected assertUsable(client: ClientBase): void {
    this.lease?.assertActive();
    if (hasLostConnection(client))
      throw driverError('DRIVER.NOT_CONNECTED', 'Postgres connection is no longer usable.');
  }

  // runQuery and runExecute normalize every error from the client, and acquireClient throws only
  // normalized or driver errors, so nothing here normalizes again.
  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const preparedStatementHandle = request.preparedStatementHandle;
    if (preparedStatementHandle === undefined || !this.options.preparedStatementsEnabled) {
      yield* this.runQuery<Row>(request);
      return;
    }
    const name = this.preparedStatementName(preparedStatementHandle);
    yield* this.withStaleHandleStreamRetry<Row>(preparedStatementHandle, name, (name) =>
      this.runQuery<Row>(request, name),
    );
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const preparedStatementHandle = request.preparedStatementHandle;
    if (preparedStatementHandle === undefined || !this.options.preparedStatementsEnabled) {
      return await this.runExecute(request);
    }
    const name = this.preparedStatementName(preparedStatementHandle);
    return await this.withStaleHandleRetry(preparedStatementHandle, name, (name) =>
      this.runExecute(request, name),
    );
  }

  private preparedStatementName(handle: PreparedStatementHandle): string {
    const existingName = handle.get();
    if (typeof existingName === 'string') {
      return existingName;
    }
    const mintedName = this.options.handleAllocator.mint();
    handle.set(mintedName);
    return mintedName;
  }

  private async withStaleHandleRetry<Result>(
    preparedStatementHandle: PreparedStatementHandle,
    name: string,
    attempt: (name: string) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await attempt(name);
    } catch (error) {
      if (!isStalePreparedStatementError(error)) {
        throw error;
      }
      // pg's parsedStatements still records the old name; only a fresh name
      // forces pg to re-Parse on this Client.
      const retryName = this.options.handleAllocator.mint();
      preparedStatementHandle.set(retryName);
      try {
        return await attempt(retryName);
      } catch (retryError) {
        throw prepareFailedError(retryError, retryName);
      }
    }
  }

  private async *withStaleHandleStreamRetry<Row>(
    preparedStatementHandle: PreparedStatementHandle,
    name: string,
    attempt: (name: string) => AsyncIterable<Row>,
  ): AsyncIterable<Row> {
    const stream = await this.withStaleHandleRetry(preparedStatementHandle, name, async (name) => {
      const iterator = attempt(name)[Symbol.asyncIterator]();
      return { iterator, first: await iterator.next() };
    });

    if (stream.first.done) {
      return;
    }

    let streamCompleted = false;
    try {
      yield stream.first.value;
      while (true) {
        const next = await stream.iterator.next();
        if (next.done) {
          streamCompleted = true;
          return;
        }
        yield next.value;
      }
    } finally {
      if (!streamCompleted) {
        await stream.iterator.return?.();
      }
    }
  }

  private async runExecute(request: SqlExecuteRequest, name?: string): Promise<SqlStatementStats> {
    const client = await this.acquireClient();
    try {
      const releaseLock = await acquireClientQueryLock(client);
      try {
        this.assertUsable(client);
        const result = await client.query({
          name,
          text: request.sql,
          values: blindCast<
            unknown[],
            'pg query types require a mutable array but pg does not mutate execution params'
          >(request.params ?? []),
        });
        return { affectedRows: result.rowCount ?? 0 };
      } finally {
        releaseLock();
      }
    } catch (error) {
      throw normalizePgClientError(client, error);
    } finally {
      await this.releaseClient(client);
    }
  }

  // Whether this queryable already runs inside an explicit transaction, so
  // cursor streaming can skip its own BEGIN/COMMIT wrap. Defaults to false:
  // a plain execute (pool or direct driver) is autocommit and needs the wrap.
  // Only PostgresTransactionImpl (always true) and PostgresConnectionImpl
  // (tracks an open beginTransaction) diverge.
  protected inExplicitTransaction(): boolean {
    return false;
  }

  private async *runQuery<Row>(request: SqlExecuteRequest, name?: string): AsyncIterable<Row> {
    const client = await this.acquireClient();
    let rows: ReadonlyArray<Record<string, unknown>>;
    try {
      if (!this.options.cursorDisabled) {
        // A cursor occupies the connection for the stream's whole lifetime,
        // so the lock spans it (BEGIN…COMMIT included); released in `finally`
        // on completion, stream error, and consumer abandonment — and before
        // the buffered fallback below, which takes its own per-statement lock.
        const releaseLock = await acquireClientQueryLock(client);
        const stream = this.streamWithPortalProtection(
          client,
          request,
          this.options.cursorBatchSize,
          name,
        )[Symbol.asyncIterator]();
        let ended = () => {};
        const termination = new Promise<void>((resolve) => {
          ended = resolve;
        });
        const forgetEnd = observeClientEnd(client, ended);
        let closing: Promise<void> | undefined;
        const close = (): Promise<void> =>
          (closing ??= (async () => {
            try {
              await Promise.race([stream.return?.(), termination]);
            } finally {
              releaseLock();
              forgetEnd();
            }
          })());
        let unregister: (() => void) | undefined;
        let unregisterClient: (() => void) | undefined;
        try {
          this.assertUsable(client);
          unregister = this.lease?.register(close);
          unregisterClient = registerClientStream(client, close);
          while (true) {
            this.assertUsable(client);
            const next = await stream.next();
            this.assertUsable(client);
            if (next.done) break;
            yield blindCast<Row, 'postgres cursor rows are dynamically shaped'>(next.value);
          }
          return;
        } catch (cursorError) {
          this.assertUsable(client);
          // Non-pg cursor-specific errors fall through to the buffered path;
          // real pg errors and errors from a lost connection propagate.
          if (
            hasLostConnection(client) ||
            !(cursorError instanceof Error) ||
            isPostgresError(cursorError)
          ) {
            throw cursorError;
          }
        } finally {
          unregister?.();
          unregisterClient?.();
          await close();
        }
      }

      rows = await this.executeBuffered(client, request.sql, request.params, name);
    } catch (error) {
      throw normalizePgClientError(client, error);
    } finally {
      await this.releaseClient(client);
    }
    for (const row of rows) {
      yield blindCast<Row, 'postgres query rows are dynamically shaped'>(row);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    // SQL is generated by Prisma 8 planners (or validated raw paths), so
    // EXPLAIN prefixing preserves the same statement semantics.
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const client = await this.acquireClient();
    try {
      const releaseLock = await acquireClientQueryLock(client);
      try {
        this.assertUsable(client);
        const result = await client
          .query(text, request.params === undefined ? undefined : [...request.params])
          .catch(rethrowClientError(client));
        return {
          rows: blindCast<ReadonlyArray<Record<string, unknown>>, 'pg does not type query rows'>(
            result.rows,
          ),
        };
      } finally {
        releaseLock();
      }
    } finally {
      await this.releaseClient(client);
    }
  }

  // A suspended cursor portal lives in the session's implicit transaction,
  // which ends at the next Sync processed on that backend session. On a
  // single-session multiplexer (a PGlite-backed `prisma dev` server, a
  // transaction-mode pooler) traffic from other logical clients — or the
  // server's own bookkeeping queries — can inject that Sync between two
  // batch reads, destroying the portal mid-stream (`portal "C_N" does not
  // exist`). An explicit transaction is the only portal lifetime the
  // protocol guarantees, so wrap streamed execution in one unless the
  // queryable is already inside a transaction.
  private async *streamWithPortalProtection(
    client: ClientBase,
    request: SqlExecuteRequest,
    cursorBatchSize: number,
    name?: string,
  ): AsyncIterable<Record<string, unknown>> {
    if (this.inExplicitTransaction()) {
      yield* this.executeWithCursor(client, request.sql, request.params, cursorBatchSize, name);
      return;
    }

    // The caller (runQuery) already holds the per-client query lock for the
    // whole stream span, so the BEGIN…COMMIT wrap cannot interleave with any
    // other query on this client.
    await client.query('BEGIN');
    let streamFailed = false;
    try {
      yield* this.executeWithCursor(client, request.sql, request.params, cursorBatchSize, name);
    } catch (error) {
      streamFailed = true;
      throw error;
    } finally {
      await this.endStreamSpan(client, streamFailed);
    }
  }

  private async endStreamSpan(client: ClientBase, streamFailed: boolean): Promise<void> {
    try {
      await client.query(
        this.lease?.active === false || hasLostConnection(client) ? 'ROLLBACK' : 'COMMIT',
      );
    } catch (settlementError) {
      if (!streamFailed) {
        throw settlementError;
      }
    }
  }

  private async *executeWithCursor(
    client: ClientBase,
    sql: string,
    params: readonly unknown[] | undefined,
    cursorBatchSize: number,
    name?: string,
  ): AsyncIterable<Record<string, unknown>> {
    const values = blindCast<
      unknown[],
      'pg cursor types require a mutable array but pg does not mutate execution params'
    >(params ?? []);
    const config = { types: serverTextTypes };
    const cursor = client.query(
      name === undefined
        ? new Cursor(sql, values, config)
        : new NamedCursor({ name, text: sql, values, config }),
    );

    try {
      while (true) {
        const rows = await readCursor(cursor, cursorBatchSize);
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          yield row;
        }
      }
    } finally {
      await closeCursor(cursor);
    }
  }

  // Return buffered rows separately so runQuery can release both the query
  // lock and its owned pool lease before handing control to the consumer.
  private async executeBuffered(
    client: PoolClient | Client,
    sql: string,
    params: readonly unknown[] | undefined,
    name?: string,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const config: QueryConfig = {
      name,
      text: sql,
      values: blindCast<
        unknown[],
        'pg query types require a mutable array but pg does not mutate execution params'
      >(params ?? []),
      types: serverTextTypes,
    };
    const releaseLock = await acquireClientQueryLock(client);
    let result: PgQueryResult;
    try {
      this.assertUsable(client);
      result = await client.query(config);
    } finally {
      releaseLock();
    }
    return blindCast<ReadonlyArray<Record<string, unknown>>, 'pg does not type query rows'>(
      result.rows,
    );
  }
}

/**
 * Transaction-open flag shared between a connection and the driver whose
 * socket it borrows. A direct driver runs every query — connection-scoped or
 * driver-level — on one client, so a driver-level query issued while the
 * connection holds an open transaction must see that state: the cursor
 * portal-protection wrap would otherwise issue its own BEGIN…COMMIT and
 * terminate the caller's transaction mid-flight.
 */
interface SharedTransactionState {
  open: boolean;
  /** A BEGIN the driver sent has not been ended by a COMMIT or ROLLBACK that succeeded. */
  unfinishedOnServer: boolean;
}

class PostgresConnectionImpl extends PostgresQueryable implements SqlConnection {
  #connection: PoolClient | Client;
  #onRelease: (() => void) | undefined;
  #onDestroy: ((reason: unknown) => Promise<void> | void) | undefined;
  #txState: SharedTransactionState;
  readonly #lease: ConnectionLease;
  #disposal: Promise<void> | undefined;
  #disposed = false;
  #destruction: { reason: unknown } | undefined;
  readonly #onInvalidated: (() => void) | undefined;

  constructor(
    connection: PoolClient | Client,
    options: ConnectionOptions,
    onRelease?: () => void,
    onDestroy?: (reason: unknown) => Promise<void> | void,
    txState?: SharedTransactionState,
    onInvalidated?: () => void,
  ) {
    const lease = new ConnectionLease();
    super(options, lease);
    this.#lease = lease;
    this.#onInvalidated = onInvalidated;
    this.#connection = connection;
    this.#onRelease = onRelease;
    this.#onDestroy = onDestroy;
    this.#txState = txState ?? { open: false, unfinishedOnServer: false };
  }

  override acquireClient(): Promise<PoolClient | Client> {
    return Promise.resolve(this.#connection);
  }

  override releaseClient(_client: PoolClient | Client): Promise<void> {
    return Promise.resolve();
  }

  protected override inExplicitTransaction(): boolean {
    return this.#txState.open;
  }

  async beginTransaction(start?: SqlTransactionOptions): Promise<SqlTransaction> {
    const statements = {
      ReadUncommitted: 'BEGIN ISOLATION LEVEL READ UNCOMMITTED',
      ReadCommitted: 'BEGIN ISOLATION LEVEL READ COMMITTED',
      RepeatableRead: 'BEGIN ISOLATION LEVEL REPEATABLE READ',
      Serializable: 'BEGIN ISOLATION LEVEL SERIALIZABLE',
    };
    const sql =
      start?.isolationLevel !== undefined
        ? statements[validatePostgresIsolationLevel(start.isolationLevel)]
        : 'BEGIN';
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      this.assertUsable(this.#connection);
      this.#txState.unfinishedOnServer = true;
      await this.#connection.query(sql).catch(rethrowClientError(this.#connection));
    } finally {
      releaseLock();
    }
    this.#txState.open = true;
    this.#txState.unfinishedOnServer = true;
    return new PostgresTransactionImpl(
      this.#connection,
      this.options,
      this.#lease,
      () => {
        this.#txState.open = false;
      },
      () => {
        this.#txState.unfinishedOnServer = false;
      },
    );
  }

  release(): Promise<void> {
    return this.#dispose(
      this.#txState.unfinishedOnServer
        ? { reason: new Error('Transaction is unfinished') }
        : undefined,
    );
  }

  destroy(reason?: unknown): Promise<void> {
    return this.#dispose({ reason });
  }

  #dispose(destroy?: { reason: unknown }): Promise<void> {
    if (this.#disposed) return this.#disposal ?? Promise.resolve();
    if (destroy !== undefined) {
      this.#destruction ??= destroy;
      this.#onInvalidated?.();
    }
    if (this.#disposal !== undefined) return this.#disposal;
    this.#lease.active = false;
    this.#disposal = this.#drainAndDispose(destroy).catch((error) => {
      this.#disposal = undefined;
      throw error;
    });
    return this.#disposal;
  }

  async #drainAndDispose(destroy: { reason: unknown } | undefined): Promise<void> {
    if (destroy !== undefined && this.#onDestroy !== undefined) {
      void this.#lease.drain().catch(() => undefined);
      void drainClientStreams(this.#connection).catch(() => undefined);
      await this.#onDestroy(destroy.reason);
      this.#onDestroy = undefined;
      this.#onRelease = undefined;
      this.#disposed = true;
      return;
    }
    let destruction = destroy;
    try {
      await this.#lease.drain();
      if (destruction !== undefined) await drainClientStreams(this.#connection);
    } catch (error) {
      destruction ??= { reason: error };
    }
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      destruction = this.#destruction ?? destruction;
      if (this.#txState.unfinishedOnServer)
        destruction ??= { reason: new Error('Transaction is unfinished') };
      if (destruction !== undefined) this.#onInvalidated?.();
      const conn = this.#connection;
      if ('release' in conn) {
        if (destruction === undefined) conn.release();
        else
          conn.release(
            destruction.reason instanceof Error
              ? destruction.reason
              : new Error('Connection destroyed'),
          );
      }
      if (destruction !== undefined && this.#onDestroy !== undefined) {
        await this.#onDestroy(destruction.reason);
      } else {
        this.#onRelease?.();
      }
      this.#onDestroy = undefined;
      this.#onRelease = undefined;
      this.#disposed = true;
    } finally {
      releaseLock();
    }
  }
}

class PostgresTransactionImpl extends PostgresQueryable implements SqlTransaction {
  #connection: PoolClient | Client;
  #onSettled: (() => void) | undefined;
  readonly #onEnded: () => void;
  #ended = false;

  constructor(
    connection: PoolClient | Client,
    options: ConnectionOptions,
    lease: ConnectionLease,
    onSettled: () => void,
    onEnded: () => void,
  ) {
    super(options, lease);
    this.#connection = connection;
    this.#onSettled = onSettled;
    this.#onEnded = onEnded;
  }

  override acquireClient(): Promise<PoolClient | Client> {
    return Promise.resolve(this.#connection);
  }

  override releaseClient(_client: PoolClient | Client): Promise<void> {
    return Promise.resolve();
  }

  protected override inExplicitTransaction(): boolean {
    return true;
  }

  protected override assertUsable(client: ClientBase): void {
    super.assertUsable(client);
    if (this.#ended) throw driverError('DRIVER.NOT_CONNECTED', 'Postgres transaction has ended.');
  }

  #settle(): void {
    this.#ended = true;
    const onSettled = this.#onSettled;
    this.#onSettled = undefined;
    onSettled?.();
  }

  // Settle in `finally` so the parent connection's transaction flag clears
  // even when COMMIT/ROLLBACK fails. Otherwise a reused connection would still
  // report inExplicitTransaction() === true and skip the BEGIN/COMMIT wrap,
  // silently reopening the portal race on a connection whose transaction state
  // no longer matches reality.
  async commit(): Promise<void> {
    this.assertUsable(this.#connection);
    this.#ended = true;
    await this.lease?.closeStreams();
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      this.lease?.assertActive();
      await this.#connection.query('COMMIT').catch(rethrowClientError(this.#connection));
      this.#onEnded();
    } finally {
      releaseLock();
      this.#settle();
    }
  }

  async rollback(): Promise<void> {
    this.#ended = true;
    await this.lease?.closeStreams();
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      this.lease?.assertActive();
      await this.#connection.query('ROLLBACK').catch(rethrowClientError(this.#connection));
      this.#onEnded();
    } finally {
      releaseLock();
      this.#settle();
    }
  }
}

class PostgresPoolDriverImpl
  extends PostgresQueryable<PoolClient>
  implements SqlDriver<PostgresBinding>
{
  private readonly pool: PoolType;
  readonly #sessionSettings: SessionSettingsGuard;
  readonly #ownedByDriver: boolean;
  #closed = false;

  constructor(
    options: PostgresDriverOptions & {
      connect: { readonly pool: PoolType; readonly ownedByDriver: boolean };
    },
  ) {
    super(buildConnectionOptions(options));
    this.pool = options.connect.pool;
    this.#sessionSettings = new SessionSettingsGuard(options.sessionSettings ?? {}, this.pool);
    this.#ownedByDriver = options.connect.ownedByDriver;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  // Bound drivers are created via createBoundDriverFromBinding with pool already
  // configured; connect is intentionally no-op.
  async connect(_binding: PostgresBinding): Promise<void> {}

  async acquireConnection(): Promise<SqlConnection> {
    const client = await this.acquireClient();
    return new PostgresConnectionImpl(client, this.options, () =>
      this.#sessionSettings.forget(client),
    );
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#ownedByDriver) {
      await this.pool.end();
    }
  }

  async acquireClient(): Promise<PoolClient> {
    // pg-pool detaches its own 'error' forwarding while a client is checked
    // out, so a connection error during a held connection, transaction, or
    // cursor emits on the client itself; without a listener that kills the
    // process.
    let pooled: PoolClient;
    try {
      pooled = await this.pool.connect();
    } catch (error) {
      throw normalizePgConnectFailure(error);
    }
    const client = watchClientLoss(suppressIdleConnectionErrors(pooled));
    try {
      await ensureSessionSettings(this.#sessionSettings, client);
    } catch (error) {
      const normalized = normalizePgClientError(client, error);
      client.release(true);
      throw normalized;
    }
    return client;
  }

  async releaseClient(client: PoolClient): Promise<void> {
    client.release();
  }
}

class PostgresDirectDriverImpl
  extends PostgresQueryable<Client>
  implements SqlDriver<PostgresBinding>
{
  private readonly directClient: Client;
  readonly #sessionSettings: SessionSettingsGuard;
  readonly #ownedByDriver: boolean;
  readonly #connectionMutex = new AsyncMutex();
  #closed = false;
  #connected = false;
  #connectPromise: Promise<void> | undefined;
  #connectFailure: Error | undefined;
  // Shared with every connection this driver hands out: one socket means a
  // driver-level query must know when a connection's transaction is open, or
  // the cursor portal-protection wrap would COMMIT the caller's transaction.
  readonly #txState: SharedTransactionState = { open: false, unfinishedOnServer: false };

  constructor(
    options: PostgresDriverOptions & {
      connect: { readonly client: Client; readonly ownedByDriver: boolean };
    },
  ) {
    super(buildConnectionOptions(options));
    this.directClient = watchClientLoss(options.connect.client);
    this.#ownedByDriver = options.connect.ownedByDriver;
    this.#sessionSettings = new SessionSettingsGuard(
      options.sessionSettings ?? {},
      this.directClient,
    );
  }

  protected override inExplicitTransaction(): boolean {
    return this.#txState.open;
  }

  protected override assertUsable(client: ClientBase): void {
    super.assertUsable(client);
    if (this.#closed) throw driverError('DRIVER.NOT_CONNECTED', 'Postgres driver is closed.');
  }

  get state(): SqlDriverState {
    return this.#closed || hasLostConnection(this.directClient) ? 'closed' : 'connected';
  }

  // Bound drivers are created via createBoundDriverFromBinding with client already
  // configured; connect is intentionally no-op.
  async connect(_binding: PostgresBinding): Promise<void> {}

  async acquireConnection(): Promise<SqlConnection> {
    const releaseLease = await this.#connectionMutex.lock();
    try {
      const client = await this.acquireClient();
      return new PostgresConnectionImpl(
        client,
        this.options,
        () => {
          this.#sessionSettings.forget(client);
          releaseLease();
        },
        // A direct driver has a single underlying socket, so a destroyed
        // connection means the driver itself is no longer usable. Tear down
        // the driver while still holding the lease so that any
        // acquireConnection() queued on #connectionMutex only observes the
        // driver after .end() has completed and #closed is set — preventing
        // a concurrent caller from reusing a socket that is already being
        // closed. The lease is released in a finally so a failing .end()
        // cannot leave the mutex permanently held.
        async () => {
          try {
            await this.#closeWhileHoldingLease({ waitForStatement: false });
          } finally {
            releaseLease();
          }
        },
        this.#txState,
        () => markClientAbandoned(client),
      );
    } catch (error) {
      releaseLease();
      throw error;
    }
  }

  async close(): Promise<void> {
    const releaseLease = await this.#connectionMutex.lock();
    try {
      await this.#closeWhileHoldingLease({ waitForStatement: true });
    } finally {
      releaseLease();
    }
  }

  // close() waits for the statement or cursor stream in flight to finish; destroy() is for a connection in an indeterminate state, so it ends the socket at once.
  async #closeWhileHoldingLease(options: { readonly waitForStatement: boolean }): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (!this.#ownedByDriver) {
      if (!options.waitForStatement) this.#giveUpSuppliedClient();
      return;
    }
    if (this.#connectFailure !== undefined) {
      // Under pg-cloudflare, end() on a client whose connect failed never settles.
      void this.directClient.end().catch(() => undefined);
      return;
    }
    const releaseQueryLock = options.waitForStatement
      ? await acquireClientQueryLock(this.directClient)
      : () => {};
    try {
      await this.directClient.end();
      clientEnded(this.directClient);
    } finally {
      releaseQueryLock();
    }
    this.#connected = false;
  }

  // The caller owns this client, so the driver does not end it. It rolls back a transaction it may
  // have left open, without waiting, and records the client as one no driver may use again.
  #giveUpSuppliedClient(): void {
    markClientAbandoned(this.directClient);
    if (this.#txState.unfinishedOnServer) {
      void this.#rollbackUnderQueryLock().catch(() => undefined);
    }
  }

  async #rollbackUnderQueryLock(): Promise<void> {
    const releaseLock = await acquireClientQueryLock(this.directClient);
    try {
      await this.directClient.query('ROLLBACK');
    } finally {
      releaseLock();
    }
  }

  // A pg.Client cannot be reused after its connection dies or a connect fails, so the driver
  // rejects instead of handing out the dead client.
  async acquireClient(): Promise<Client> {
    if (this.#connectFailure !== undefined) {
      throw this.#connectFailure;
    }
    if (this.#closed || hasLostConnection(this.directClient)) {
      throw driverError(
        'DRIVER.NOT_CONNECTED',
        'Postgres connection lost or closed. Create a new client to reconnect.',
      );
    }
    if (!this.#connected) await this.#connectDirectClient();
    await ensureSessionSettings(this.#sessionSettings, this.directClient).catch(
      rethrowClientError(this.directClient),
    );
    return this.directClient;
  }

  async #connectDirectClient(): Promise<void> {
    if (this.#connectPromise === undefined) {
      if (hasStartedConnecting(this.directClient)) {
        this.#connected = true;
        return;
      }
      this.#connectPromise = this.#connectClient();
    }
    await this.#connectPromise;
  }

  async #connectClient(): Promise<void> {
    try {
      await this.directClient.connect();
    } catch (error: unknown) {
      this.#connectFailure = normalizePgConnectFailure(error);
      this.#connectPromise = undefined;
      throw this.#connectFailure;
    }
    this.#connected = true;
  }

  async releaseClient(_client: Client): Promise<void> {}
}

export function createBoundDriverFromBinding(
  binding: PostgresBinding,
  cursorOpts: PostgresDriverCreateOptions['cursor'],
  extraOpts?: Pick<PostgresDriverCreateOptions, 'preparedStatements' | 'sessionSettings'>,
): SqlDriver<PostgresBinding> {
  const preparedStatements = extraOpts?.preparedStatements;
  const sessionSettings = extraOpts?.sessionSettings;
  switch (binding.kind) {
    case 'url': {
      const pool = suppressIdleConnectionErrors(
        createPgPool(
          {
            connectionString: binding.url,
            connectionTimeoutMillis: 20_000,
            idleTimeoutMillis: 30_000,
          },
          sessionSettings ?? {},
        ),
      );
      return new PostgresPoolDriverImpl({
        connect: { pool, ownedByDriver: true },
        cursor: cursorOpts,
        preparedStatements,
        sessionSettings,
      });
    }
    case 'pgPool':
      return new PostgresPoolDriverImpl({
        connect: {
          pool: suppressIdleConnectionErrors(binding.pool),
          ownedByDriver: binding.ownedByDriver,
        },
        cursor: cursorOpts,
        preparedStatements,
        sessionSettings,
      });
    case 'pgClient':
      if (hasLostConnection(binding.client)) {
        throw driverError(
          'DRIVER.NOT_CONNECTED',
          'This pg client lost its connection or was given up by an earlier driver. Create a new client to reconnect.',
        );
      }
      return new PostgresDirectDriverImpl({
        connect: {
          client: suppressIdleConnectionErrors(binding.client),
          ownedByDriver: binding.ownedByDriver,
        },
        cursor: cursorOpts,
        preparedStatements,
        sessionSettings,
      });
  }
}

/** Ensures the session settings on a client the driver is about to use, holding the client's query lock while it does. */
async function ensureSessionSettings(
  guard: SessionSettingsGuard,
  client: ClientBase,
): Promise<void> {
  if (!guard.needs(client)) return;
  const releaseLock = await acquireClientQueryLock(client);
  try {
    await guard.ensure(client);
  } finally {
    releaseLock();
  }
}

function readCursor<Row>(cursor: Cursor<Row>, size: number): Promise<Row[]> {
  return callbackToPromise<Row[]>((cb) => {
    cursor.read(size, (err, rows) => cb(err, rows));
  });
}

function closeCursor(cursor: Cursor<unknown>): Promise<void> {
  return callbackToPromise((cb) => cursor.close(cb));
}

function rethrowClientError(client: PoolClient | Client): (error: unknown) => never {
  return (error) => {
    throw normalizePgClientError(client, error);
  };
}

// ADR 210 § Stale-handle retry: a re-prepare that fails again surfaces a
// stable code, carrying the driver error as `cause`. ADR 239 governs the
// namespace — `DRIVER` covers driver transport and error normalization.
function prepareFailedError(retryError: unknown, handle: string): DriverRuntimeError {
  const cause = retryError instanceof Error ? retryError : new Error(String(retryError));
  return Object.assign(
    driverError(
      'DRIVER.PREPARE_FAILED',
      `Prepared statement failed again after re-preparing with a fresh handle: ${cause.message}`,
      { handle },
    ),
    { cause },
  );
}
