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
} from '@internal/sql-relational-core/ast';
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
import { Pool } from 'pg';
import Cursor from 'pg-cursor';
import { callbackToPromise } from './callback-to-promise';
import { type DriverRuntimeError, driverError } from './driver-error';
import { NamedCursor } from './named-cursor';
import { isAlreadyConnectedError, isPostgresError, normalizePgError } from './normalize-error';
import { temporalTextTypes } from './temporal-text-parsers';

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
  | { readonly kind: 'pgPool'; readonly pool: PoolType }
  | { readonly kind: 'pgClient'; readonly client: Client };

export interface PostgresCursorOptions {
  readonly batchSize?: number;
  readonly disabled?: boolean;
}

interface PostgresDriverOptions {
  readonly connect: { client: Client } | { pool: PoolType };
  readonly cursor?: PostgresCursorOptions | undefined;
  /**
   * Use server-side prepared statements for `query()` requests with a
   * prepared-statement handle. Default
   * `true`. Set `false` when running behind a transaction-mode pooler that
   * does not support session-scoped prepared statements (e.g. PgBouncer
   * transaction mode).
   */
  readonly preparedStatements?: boolean | undefined;
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

function isStalePreparedStatementError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') {
    return false;
  }
  const code = error.code;
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

function acquireClientQueryLock(client: object): Promise<() => void> {
  let mutex = clientQueryLocks.get(client);
  if (mutex === undefined) {
    mutex = new AsyncMutex();
    clientQueryLocks.set(client, mutex);
  }
  return mutex.lock();
}

abstract class PostgresQueryable<C extends PoolClient | Client = PoolClient | Client>
  implements SqlQueryable
{
  abstract acquireClient(): Promise<C>;
  abstract releaseClient(client: C): Promise<void>;

  protected readonly options: ConnectionOptions;

  constructor(options: ConnectionOptions) {
    this.options = options;
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const preparedStatementHandle = request.preparedStatementHandle;
      if (preparedStatementHandle === undefined || !this.options.preparedStatementsEnabled) {
        yield* this.runQuery<Row>(request);
        return;
      }
      const name = this.preparedStatementName(preparedStatementHandle);
      yield* this.withStaleHandleStreamRetry<Row>(preparedStatementHandle, name, (name) =>
        this.runQuery<Row>(request, name),
      );
    } catch (error) {
      throw normalizePgError(error);
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    try {
      const preparedStatementHandle = request.preparedStatementHandle;
      if (preparedStatementHandle === undefined || !this.options.preparedStatementsEnabled) {
        return await this.runExecute(request);
      }
      const name = this.preparedStatementName(preparedStatementHandle);
      return await this.withStaleHandleRetry(preparedStatementHandle, name, (name) =>
        this.runExecute(request, name),
      );
    } catch (error) {
      throw normalizePgError(error);
    }
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

  // Errors propagate as raw pg errors so the caller can read SQLSTATE before
  // normalising (the prepared-statement retry layer needs the original code).
  private async *runQuery<Row>(request: SqlExecuteRequest, name?: string): AsyncIterable<Row> {
    const client = await this.acquireClient();
    try {
      if (!this.options.cursorDisabled) {
        // A cursor occupies the connection for the stream's whole lifetime,
        // so the lock spans it (BEGIN…COMMIT included); released in `finally`
        // on completion, stream error, and consumer abandonment — and before
        // the buffered fallback below, which takes its own per-statement lock.
        const releaseLock = await acquireClientQueryLock(client);
        try {
          for await (const row of this.streamWithPortalProtection(
            client,
            request,
            this.options.cursorBatchSize,
            name,
          )) {
            yield blindCast<Row, 'postgres cursor rows are dynamically shaped'>(row);
          }
          return;
        } catch (cursorError) {
          // Non-pg cursor-specific errors fall through to the buffered path;
          // real pg errors propagate.
          if (!(cursorError instanceof Error) || isPostgresError(cursorError)) {
            throw cursorError;
          }
        } finally {
          releaseLock();
        }
      }

      for await (const row of this.executeBuffered(client, request.sql, request.params, name)) {
        yield blindCast<Row, 'postgres query rows are dynamically shaped'>(row);
      }
    } finally {
      await this.releaseClient(client);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    // SQL is generated by Prisma Next planners (or validated raw paths), so
    // EXPLAIN prefixing preserves the same statement semantics.
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const client = await this.acquireClient();
    try {
      const releaseLock = await acquireClientQueryLock(client);
      try {
        const result = await client
          .query(text, request.params === undefined ? undefined : [...request.params])
          .catch(rethrowNormalizedError);
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
      // Terminating COMMIT runs on every exit — normal completion, stream
      // error, and consumer abandonment (early `.return()`), the last of
      // which leaves the generator right after this `finally`, so the COMMIT
      // and its error handling must live inside it. `commitStreamSpan`
      // surfaces a failing COMMIT unless the stream itself already threw
      // (then that error wins).
      await this.commitStreamSpan(client, streamFailed);
    }
  }

  // COMMIT also terminates an aborted transaction (Postgres downgrades it to
  // ROLLBACK), so this one terminator covers success, error, and abandonment.
  // The throw lives here rather than lexically in the caller's `finally` both
  // to keep that failure on every exit path and to avoid a `throw` inside a
  // `finally` block.
  private async commitStreamSpan(client: ClientBase, streamFailed: boolean): Promise<void> {
    try {
      await client.query('COMMIT');
    } catch (commitError) {
      if (!streamFailed) {
        throw commitError;
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
    const config = { types: temporalTextTypes };
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

  // The lock covers only the fetch: once `client.query` resolves the client
  // is protocol-idle, and holding the lock across the yields would hand its
  // lifetime to the consumer (deadlocking a nested query inside `for await`).
  private async *executeBuffered(
    client: PoolClient | Client,
    sql: string,
    params: readonly unknown[] | undefined,
    name?: string,
  ): AsyncIterable<Record<string, unknown>> {
    const config: QueryConfig = {
      name,
      text: sql,
      values: blindCast<
        unknown[],
        'pg query types require a mutable array but pg does not mutate execution params'
      >(params ?? []),
      types: temporalTextTypes,
    };
    const releaseLock = await acquireClientQueryLock(client);
    let result: PgQueryResult;
    try {
      result = await client.query(config);
    } finally {
      releaseLock();
    }
    for (const row of blindCast<
      ReadonlyArray<Record<string, unknown>>,
      'pg does not type query rows'
    >(result.rows)) {
      yield row;
    }
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
}

class PostgresConnectionImpl extends PostgresQueryable implements SqlConnection {
  #connection: PoolClient | Client;
  #onRelease: (() => void) | undefined;
  #onDestroy: ((reason: unknown) => Promise<void> | void) | undefined;
  #txState: SharedTransactionState;

  constructor(
    connection: PoolClient | Client,
    options: ConnectionOptions,
    onRelease?: () => void,
    onDestroy?: (reason: unknown) => Promise<void> | void,
    txState?: SharedTransactionState,
  ) {
    super(options);
    this.#connection = connection;
    this.#onRelease = onRelease;
    this.#onDestroy = onDestroy;
    this.#txState = txState ?? { open: false };
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

  async beginTransaction(): Promise<SqlTransaction> {
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      await this.#connection.query('BEGIN').catch(rethrowNormalizedError);
    } finally {
      releaseLock();
    }
    this.#txState.open = true;
    return new PostgresTransactionImpl(this.#connection, this.options, () => {
      this.#txState.open = false;
    });
  }

  async release(): Promise<void> {
    const conn = this.#connection;
    if ('release' in conn) {
      conn.release();
    }
    const onRelease = this.#onRelease;
    this.#onRelease = undefined;
    this.#onDestroy = undefined;
    onRelease?.();
  }

  async destroy(reason?: unknown): Promise<void> {
    const onDestroy = this.#onDestroy;
    const onRelease = this.#onRelease;
    this.#onDestroy = undefined;
    this.#onRelease = undefined;

    const conn = this.#connection;
    if ('release' in conn) {
      // Pass a truthy Error to pg's PoolClient.release so the pool evicts the
      // client instead of returning it for reuse. A connection that reaches
      // destroy() is in an indeterminate state (failed rollback/commit, etc.)
      // and must not be handed back to another caller. The Error value is
      // surfaced on pg-pool's 'release' event as advisory context; pg-pool
      // itself only uses its truthiness for the eviction decision.
      const releaseArg: Error =
        reason instanceof Error ? reason : new Error('Connection destroyed');
      conn.release(releaseArg);
    }

    if (onDestroy) {
      await onDestroy(reason);
    } else {
      onRelease?.();
    }
  }
}

class PostgresTransactionImpl extends PostgresQueryable implements SqlTransaction {
  #connection: PoolClient | Client;
  #onSettled: (() => void) | undefined;

  constructor(connection: PoolClient | Client, options: ConnectionOptions, onSettled?: () => void) {
    super(options);
    this.#connection = connection;
    this.#onSettled = onSettled;
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

  #settle(): void {
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
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      await this.#connection.query('COMMIT').catch(rethrowNormalizedError);
    } finally {
      releaseLock();
      this.#settle();
    }
  }

  async rollback(): Promise<void> {
    const releaseLock = await acquireClientQueryLock(this.#connection);
    try {
      await this.#connection.query('ROLLBACK').catch(rethrowNormalizedError);
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
  #closed = false;

  constructor(options: PostgresDriverOptions & { connect: { pool: PoolType } }) {
    super(buildConnectionOptions(options));
    this.pool = options.connect.pool;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  // Bound drivers are created via createBoundDriverFromBinding with pool already
  // configured; connect is intentionally no-op.
  async connect(_binding: PostgresBinding): Promise<void> {}

  async acquireConnection(): Promise<SqlConnection> {
    const client = await this.acquireClient();
    return new PostgresConnectionImpl(client, this.options);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.pool.end();
  }

  async acquireClient(): Promise<PoolClient> {
    // pg-pool detaches its own 'error' forwarding while a client is checked
    // out, so a connection error during a held connection, transaction, or
    // cursor emits on the client itself; without a listener that kills the
    // process.
    return suppressIdleConnectionErrors(await this.pool.connect());
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
  readonly #connectionMutex = new AsyncMutex();
  #closed = false;
  #connected = false;
  #connectPromise: Promise<void> | undefined;
  // Shared with every connection this driver hands out: one socket means a
  // driver-level query must know when a connection's transaction is open, or
  // the cursor portal-protection wrap would COMMIT the caller's transaction.
  readonly #txState: SharedTransactionState = { open: false };

  constructor(options: PostgresDriverOptions & { connect: { client: Client } }) {
    super(buildConnectionOptions(options));
    this.directClient = options.connect.client;
    // A pg.Client cannot be reused after its connection dies, so mark the
    // driver closed and let acquireClient reject with a clear error instead
    // of handing out the dead client.
    this.directClient.on('error', () => {
      this.#closed = true;
      this.#connected = false;
    });
  }

  protected override inExplicitTransaction(): boolean {
    return this.#txState.open;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
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
        releaseLease,
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
            await this.#closeWhileHoldingLease();
          } finally {
            releaseLease();
          }
        },
        this.#txState,
      );
    } catch (error) {
      releaseLease();
      throw error;
    }
  }

  async close(): Promise<void> {
    const releaseLease = await this.#connectionMutex.lock();
    try {
      await this.#closeWhileHoldingLease();
    } finally {
      releaseLease();
    }
  }

  async #closeWhileHoldingLease(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.directClient.end();
    this.#connected = false;
  }

  async acquireClient(): Promise<Client> {
    if (this.#closed) {
      throw driverError(
        'DRIVER.NOT_CONNECTED',
        'Postgres connection lost or closed. Create a new client to reconnect.',
      );
    }
    if (this.#connected) {
      return this.directClient;
    }
    if (this.#connectPromise !== undefined) {
      await this.#connectPromise;
      return this.directClient;
    }

    this.#connectPromise = (async () => {
      try {
        await this.directClient.connect();
      } catch (error: unknown) {
        if (!isAlreadyConnectedError(error)) {
          throw error;
        }
      } finally {
        this.#connectPromise = undefined;
      }
      this.#connected = true;
    })();
    await this.#connectPromise;

    return this.directClient;
  }

  async releaseClient(_client: Client): Promise<void> {}
}

export function createBoundDriverFromBinding(
  binding: PostgresBinding,
  cursorOpts: PostgresDriverCreateOptions['cursor'],
  extraOpts?: Pick<PostgresDriverCreateOptions, 'preparedStatements'>,
): SqlDriver<PostgresBinding> {
  const preparedStatements = extraOpts?.preparedStatements;
  switch (binding.kind) {
    case 'url': {
      const pool = suppressIdleConnectionErrors(
        new Pool({
          connectionString: binding.url,
          connectionTimeoutMillis: 20_000,
          idleTimeoutMillis: 30_000,
        }),
      );
      return new PostgresPoolDriverImpl({
        connect: { pool },
        cursor: cursorOpts,
        preparedStatements,
      });
    }
    case 'pgPool':
      return new PostgresPoolDriverImpl({
        connect: { pool: suppressIdleConnectionErrors(binding.pool) },
        cursor: cursorOpts,
        preparedStatements,
      });
    case 'pgClient':
      return new PostgresDirectDriverImpl({
        connect: { client: suppressIdleConnectionErrors(binding.client) },
        cursor: cursorOpts,
        preparedStatements,
      });
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

function rethrowNormalizedError(error: unknown): never {
  throw normalizePgError(error);
}

// ADR 210 § Stale-handle retry: a re-prepare that fails again surfaces a
// stable code, carrying the driver error as `cause`. ADR 239 governs the
// namespace — `DRIVER` covers driver transport and error normalization.
function prepareFailedError(retryError: unknown, handle: string): DriverRuntimeError {
  const cause = normalizePgError(retryError);
  return Object.assign(
    driverError(
      'DRIVER.PREPARE_FAILED',
      `Prepared statement failed again after re-preparing with a fresh handle: ${cause.message}`,
      { handle },
    ),
    { cause },
  );
}
