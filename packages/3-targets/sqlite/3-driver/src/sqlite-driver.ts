import { DatabaseSync } from 'node:sqlite';
import type { RuntimeDriverInstance } from '@internal/framework-components/execution';
import type {
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
import { validateSqliteIsolationLevel } from '@internal/target-sqlite/runtime';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { closeDatabase, wasClosedByDriver } from './database-state';
import { normalizeSqliteError } from './normalize-error';
import { sqliteParams } from './sqlite-params';

export type SqliteBinding = { readonly kind: 'path'; readonly path: string };

export type SqliteRuntimeDriver = RuntimeDriverInstance<'sql', 'sqlite'> & SqlDriver<SqliteBinding>;

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED';
  readonly category: 'DRIVER';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const error = new Error(message);
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'DRIVER' as const,
    severity: 'error' as const,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

const NOT_CONNECTED_MESSAGE =
  'SQLite driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'SQLite driver already connected. Call close() before reconnecting with a new binding.';

function openConnection(path: string): DatabaseSync {
  try {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  } catch (error) {
    throw normalizeSqliteError(error, false);
  }
}

class SqliteScope {
  #active = true;
  readonly #closers = new Set<() => void>();

  constructor(readonly parent?: SqliteScope) {}

  assertActive(): void {
    this.parent?.assertActive();
    if (!this.#active)
      throw driverError('DRIVER.NOT_CONNECTED', 'SQLite execution scope has ended.');
  }

  register(close: () => void): () => void {
    this.assertActive();
    const unregisterParent = this.parent?.register(close);
    this.#closers.add(close);
    return () => {
      this.#closers.delete(close);
      unregisterParent?.();
    };
  }

  close(): void {
    this.#active = false;
    let failure: { error: unknown } | undefined;
    for (const close of this.#closers) {
      try {
        close();
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== undefined) throw failure.error;
  }
}

interface SqliteTransactionState {
  current: SqliteScope | undefined;
}

abstract class SqliteQueryable implements SqlQueryable {
  protected readonly db: DatabaseSync;

  constructor(
    db: DatabaseSync,
    protected readonly scope = new SqliteScope(),
  ) {
    this.db = db;
  }

  protected queryScope(): SqliteScope {
    return this.scope;
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const scope = this.queryScope();
      scope.assertActive();
      const stmt = this.db.prepare(request.sql);
      const iterator = stmt.iterate(...sqliteParams(request.params));
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          iterator.return?.();
        } finally {
          unregister();
        }
      };
      const unregister = scope.register(close);
      try {
        while (true) {
          scope.assertActive();
          const next = iterator.next();
          if (next.done) break;
          yield blindCast<Row, 'SQLite rows follow the caller query shape'>(next.value);
        }
      } finally {
        close();
      }
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    try {
      this.scope.assertActive();
      const stmt = this.db.prepare(request.sql);
      if (stmt.columns().length !== 0) {
        throw new InternalError('SQLite cannot execute statements that return rows.');
      }
      const { changes, lastInsertRowid } = stmt.run(...sqliteParams(request.params));
      const affectedRows = Number(changes);
      return affectedRows === 1
        ? { affectedRows, insertId: String(lastInsertRowid) }
        : { affectedRows };
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      this.scope.assertActive();
      const stmt = this.db.prepare(`EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...sqliteParams(request.params));
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

export class SqliteConnectionImpl extends SqliteQueryable implements SqlConnection {
  readonly #transactions: SqliteTransactionState = { current: undefined };

  protected override queryScope(): SqliteScope {
    return this.#transactions.current ?? this.scope;
  }

  async beginTransaction(start?: SqlTransactionOptions): Promise<SqlTransaction> {
    if (start?.isolationLevel !== undefined) {
      validateSqliteIsolationLevel(start.isolationLevel);
    }
    try {
      this.scope.assertActive();
      this.db.exec('BEGIN');
      const scope = new SqliteScope(this.scope);
      this.#transactions.current = scope;
      return new SqliteTransactionImpl(this.db, scope, this.#transactions);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async release(): Promise<void> {
    return this.destroy();
  }

  async destroy(_reason?: unknown): Promise<void> {
    try {
      this.scope.close();
      if (!wasClosedByDriver(this.db)) closeDatabase(this.db);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

class SqliteTransactionImpl extends SqliteQueryable implements SqlTransaction {
  #completed = false;

  constructor(
    db: DatabaseSync,
    scope: SqliteScope,
    private readonly transactions: SqliteTransactionState,
  ) {
    super(db, scope);
  }

  async commit(): Promise<void> {
    try {
      this.scope.assertActive();
      this.scope.close();
      this.db.exec('COMMIT');
      this.#completed = true;
      this.transactions.current = undefined;
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async rollback(): Promise<void> {
    if (this.#completed) return;
    try {
      this.scope.parent?.assertActive();
      if (this.transactions.current !== this.scope)
        throw driverError('DRIVER.NOT_CONNECTED', 'SQLite transaction has been replaced.');
      this.scope.close();
      this.db.exec('ROLLBACK');
      this.#completed = true;
      this.transactions.current = undefined;
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

interface ConnectedState {
  readonly kind: 'connected';
  readonly path: string;
  readonly conn: SqliteConnectionImpl;
}

type DriverState = { readonly kind: 'unbound' } | ConnectedState | { readonly kind: 'closed' };

function unboundQuery<Row>(): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw driverError('DRIVER.NOT_CONNECTED', NOT_CONNECTED_MESSAGE);
        },
      };
    },
  };
}

export class SqliteDriver implements SqliteRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  #state: DriverState;

  constructor(initialState?: ConnectedState) {
    this.#state = initialState ?? { kind: 'unbound' };
  }

  #requireConnected(): ConnectedState {
    if (this.#state.kind !== 'connected') {
      throw driverError('DRIVER.NOT_CONNECTED', NOT_CONNECTED_MESSAGE);
    }
    return this.#state;
  }

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  async connect(binding: SqliteBinding): Promise<void> {
    if (this.#state.kind === 'connected') {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#state = {
      kind: 'connected',
      path: binding.path,
      conn: new SqliteConnectionImpl(openConnection(binding.path)),
    };
  }

  async acquireConnection(): Promise<SqliteConnectionImpl> {
    const { path } = this.#requireConnected();
    return new SqliteConnectionImpl(openConnection(path));
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { conn } = this.#state;
    this.#state = { kind: 'closed' };
    await conn.release();
  }

  query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    if (this.#state.kind !== 'connected') {
      return unboundQuery<Row>();
    }
    return this.#state.conn.query<Row>(request);
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    return this.#requireConnected().conn.execute(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    return this.#requireConnected().conn.explain(request);
  }
}

export function createBoundDriverFromBinding(binding: SqliteBinding): SqliteDriver {
  return new SqliteDriver({
    kind: 'connected',
    path: binding.path,
    conn: new SqliteConnectionImpl(openConnection(binding.path)),
  });
}
