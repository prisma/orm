import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
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
import { prepareExact, safeIntegersAsNumbers } from './exact-integers';
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

abstract class SqliteQueryable implements SqlQueryable {
  protected readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async *query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    let rows: Iterator<Record<string, SQLOutputValue>> | undefined;
    try {
      rows = prepareExact(this.db, request.sql).iterate(...sqliteParams(request.params));
      for (let next = rows.next(); next.done !== true; next = rows.next()) {
        yield blindCast<Row, 'SQLite rows follow the caller query shape'>(
          safeIntegersAsNumbers(next.value),
        );
      }
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    } finally {
      if (this.db.isOpen) rows?.return?.();
    }
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    try {
      const stmt = prepareExact(this.db, request.sql);
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
      const stmt = prepareExact(this.db, `EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...sqliteParams(request.params)).map(safeIntegersAsNumbers);
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }
}

export class SqliteConnectionImpl extends SqliteQueryable implements SqlConnection {
  async beginTransaction(start?: SqlTransactionOptions): Promise<SqlTransaction> {
    if (start?.isolationLevel !== undefined) {
      validateSqliteIsolationLevel(start.isolationLevel);
    }
    try {
      this.db.exec('BEGIN');
      return new SqliteTransactionImpl(this.db);
    } catch (error) {
      throw normalizeSqliteError(error, wasClosedByDriver(this.db));
    }
  }

  async release(): Promise<void> {
    return this.destroy();
  }

  async destroy(_reason?: unknown): Promise<void> {
    try {
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
    return openSqliteSavepoint(this.db, name);
  }
}

class SqliteSavepointImpl extends SqliteQueryable implements SqlTransaction {
  constructor(
    db: DatabaseSync,
    private readonly name: string,
  ) {
    super(db);
  }

  async commit(): Promise<void> {
    execSavepointStatement(this.db, `RELEASE SAVEPOINT ${this.name}`);
  }

  async rollback(): Promise<void> {
    execSavepointStatement(this.db, `ROLLBACK TO SAVEPOINT ${this.name}`);
  }

  async savepoint(name: string): Promise<SqlTransaction> {
    return openSqliteSavepoint(this.db, name);
  }
}

function execSavepointStatement(db: DatabaseSync, sql: string): void {
  try {
    db.exec(sql);
  } catch (error) {
    throw normalizeSqliteError(error, wasClosedByDriver(db));
  }
}

function openSqliteSavepoint(db: DatabaseSync, name: string): SqliteSavepointImpl {
  execSavepointStatement(db, `SAVEPOINT ${name}`);
  return new SqliteSavepointImpl(db, name);
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
