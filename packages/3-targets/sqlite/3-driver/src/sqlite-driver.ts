import { DatabaseSync, type SQLOutputValue, type StatementSync } from 'node:sqlite';
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
import { safeIntegersAsNumbers } from './exact-integers';
import { normalizeSqliteError } from './normalize-error';
import { sqliteParams } from './sqlite-params';
import { SqliteStatementCache } from './statement-cache';

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
  const error = new Error(message) as DriverRuntimeError;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'DRIVER' as const,
    severity: 'error' as const,
    message,
    details,
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

/** Takes a released connection's database for reuse instead of closing it. */
interface SqliteConnectionHome {
  /** Takes the database into the idle slot; false means the caller must close it. */
  reclaim(db: DatabaseSync, statements: SqliteStatementCache): boolean;
  /** Drops the database from the idle slot when its connection closes it some other way. */
  discard(db: DatabaseSync): void;
}

interface IdleSqliteConnection {
  readonly db: DatabaseSync;
  readonly statements: SqliteStatementCache;
}

abstract class SqliteQueryable implements SqlQueryable {
  protected readonly db: DatabaseSync;
  protected readonly statements: SqliteStatementCache;

  constructor(db: DatabaseSync, statements: SqliteStatementCache) {
    this.db = db;
    this.statements = statements;
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    let rows: Iterator<Record<string, SQLOutputValue>> | undefined;
    let statement: StatementSync | undefined;
    try {
      statement = this.statements.prepare(this.db, request.sql);
      this.statements.beginRead(statement);
      rows = statement.iterate(...sqliteParams(request.params));
      for (let next = rows.next(); next.done !== true; next = rows.next()) {
        yield blindCast<Row, 'SQLite rows follow the caller query shape'>(
          safeIntegersAsNumbers(next.value),
        );
      }
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    } finally {
      if (statement !== undefined) {
        this.statements.endRead(statement);
      }
      if (this.db.isOpen) rows?.return?.();
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    try {
      const stmt = this.statements.prepare(this.db, request.sql);
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
      const stmt = this.statements.prepare(this.db, `EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...sqliteParams(request.params)).map(safeIntegersAsNumbers);
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

export class SqliteConnectionImpl extends SqliteQueryable implements SqlConnection {
  readonly #home: SqliteConnectionHome | undefined;

  constructor(db: DatabaseSync, home?: SqliteConnectionHome, statements?: SqliteStatementCache) {
    super(db, statements ?? new SqliteStatementCache());
    this.#home = home;
  }

  async beginTransaction(start?: SqlTransactionOptions): Promise<SqlTransaction> {
    if (start?.isolationLevel !== undefined) {
      validateSqliteIsolationLevel(start.isolationLevel);
    }
    try {
      this.db.exec('BEGIN');
      return new SqliteTransactionImpl(this.db, this.statements);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async release(): Promise<void> {
    if (this.#home?.reclaim(this.db, this.statements) === true) {
      return;
    }
    return this.destroy();
  }

  async destroy(_reason?: unknown): Promise<void> {
    try {
      this.#home?.discard(this.db);
      closeDatabase(this.db);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

class SqliteTransactionImpl extends SqliteQueryable implements SqlTransaction {
  async commit(): Promise<void> {
    try {
      this.db.exec('COMMIT');
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async rollback(): Promise<void> {
    try {
      this.db.exec('ROLLBACK');
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async savepoint(name: string): Promise<SqlTransaction> {
    return openSqliteSavepoint(this.db, this.statements, name);
  }
}

class SqliteSavepointImpl extends SqliteQueryable implements SqlTransaction {
  constructor(
    db: DatabaseSync,
    statements: SqliteStatementCache,
    private readonly name: string,
  ) {
    super(db, statements);
  }

  async commit(): Promise<void> {
    execSavepointStatement(this.db, `RELEASE SAVEPOINT ${this.name}`);
  }

  async rollback(): Promise<void> {
    execSavepointStatement(this.db, `ROLLBACK TO SAVEPOINT ${this.name}`);
  }

  async savepoint(name: string): Promise<SqlTransaction> {
    return openSqliteSavepoint(this.db, this.statements, name);
  }
}

function execSavepointStatement(db: DatabaseSync, sql: string): void {
  try {
    db.exec(sql);
  } catch (error) {
    throw normalizeSqliteError(error, wasClosedByDriver(db));
  }
}

function openSqliteSavepoint(
  db: DatabaseSync,
  statements: SqliteStatementCache,
  name: string,
): SqliteSavepointImpl {
  execSavepointStatement(db, `SAVEPOINT ${name}`);
  return new SqliteSavepointImpl(db, statements, name);
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
  readonly #home: SqliteConnectionHome;
  #idle: IdleSqliteConnection | undefined;

  constructor(initialState?: ConnectedState) {
    this.#state = initialState ?? { kind: 'unbound' };
    this.#home = {
      reclaim: (db, statements) => this.#reclaim(db, statements),
      discard: (db) => this.#discard(db),
    };
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
    const idle = this.#idle;
    if (idle === undefined) {
      return new SqliteConnectionImpl(openConnection(path), this.#home);
    }
    this.#idle = undefined;
    return new SqliteConnectionImpl(idle.db, this.#home, idle.statements);
  }

  #reclaim(db: DatabaseSync, statements: SqliteStatementCache): boolean {
    if (this.#idle !== undefined) {
      return false;
    }
    // A database still inside a transaction, or still serving an unfinished read, is not in a
    // reusable state; closing it is what release() did before reuse existed.
    if (db.isTransaction !== false) {
      return false;
    }
    if (statements.hasActiveRead()) {
      return false;
    }
    this.#idle = { db, statements };
    return true;
  }

  #discard(db: DatabaseSync): void {
    if (this.#idle?.db === db) {
      this.#idle = undefined;
    }
  }

  #drainIdle(): void {
    const idle = this.#idle;
    if (idle === undefined) return;
    this.#idle = undefined;
    try {
      closeDatabase(idle.db);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(idle.db));
    }
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { conn } = this.#state;
    this.#state = { kind: 'closed' };
    this.#drainIdle();
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
