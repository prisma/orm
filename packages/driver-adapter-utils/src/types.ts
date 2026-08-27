import { ColumnTypeEnum } from './const'
import { Result } from './result'

export type ColumnType = (typeof ColumnTypeEnum)[keyof typeof ColumnTypeEnum]

/**
 * Represents a value that can be returned for a column from `queryRaw`.
 */
export type ResultValue = number | string | boolean | null | ResultValue[] | Uint8Array

export interface SqlResultSet {
  /**
   * List of column types appearing in a database query, in the same order as `columnNames`.
   * They are used within the Query Engine to convert values from JS to Quaint values.
   */
  columnTypes: Array<ColumnType>

  /**
   * List of column names appearing in a database query, in the same order as `columnTypes`.
   */
  columnNames: Array<string>

  /**
   * List of rows retrieved from a database query.
   * Each row is a list of values, whose length matches `columnNames` and `columnTypes`.
   */
  rows: Array<Array<unknown>>

  /**
   * The last ID of an `INSERT` statement, if any.
   * This is required for `AUTO_INCREMENT` columns in databases based on MySQL and SQLite.
   */
  lastInsertId?: string
}

export type ArgType = {
  scalarType: ArgScalarType
  dbType?: string
  arity: Arity
}

export type ArgScalarType =
  | 'string'
  | 'int'
  | 'bigint'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'enum'
  | 'uuid'
  | 'json'
  | 'datetime'
  | 'bytes'
  | 'unknown'

export type Arity = 'scalar' | 'list'

export type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SNAPSHOT' | 'SERIALIZABLE'

export type SqlQuery = {
  sql: string
  args: Array<unknown>
  argTypes: Array<ArgType>
}

export type Error = MappedError & { originalCode?: string; originalMessage?: string }

export type MappedError =
  | {
      kind: 'GenericJs'
      id: number
    }
  | {
      kind: 'UnsupportedNativeDataType'
      type: string
    }
  | {
      kind: 'InvalidIsolationLevel'
      level: string
    }
  | {
      kind: 'LengthMismatch'
      column?: string
    }
  | {
      kind: 'UniqueConstraintViolation'
      constraint?: { fields: string[] } | { index: string } | { foreignKey: {} }
      table?: string
    }
  | {
      kind: 'NullConstraintViolation'
      constraint?: { fields: string[] } | { index: string } | { foreignKey: {} }
    }
  | {
      kind: 'ForeignKeyConstraintViolation'
      constraint?: { fields: string[] } | { index: string } | { foreignKey: {} }
    }
  | {
      kind: 'RestrictViolation'
      constraint?: { fields: string[] } | { index: string } | { foreignKey: {} }
    }
  | {
      kind: 'DatabaseNotReachable'
      host?: string
      port?: number
    }
  | {
      kind: 'DatabaseDoesNotExist'
      db?: string
    }
  | {
      kind: 'DatabaseAlreadyExists'
      db?: string
    }
  | {
      kind: 'DatabaseAccessDenied'
      db?: string
    }
  | {
      kind: 'ConnectionClosed'
    }
  | {
      kind: 'TlsConnectionError'
      reason: string
    }
  | {
      kind: 'AuthenticationFailed'
      user?: string
    }
  | {
      kind: 'TransactionWriteConflict'
    }
  | {
      kind: 'TableDoesNotExist'
      table?: string
    }
  | {
      kind: 'ColumnNotFound'
      column?: string
    }
  | {
      kind: 'TooManyConnections'
      cause: string
    }
  | {
      kind: 'ValueOutOfRange'
      cause: string
    }
  | {
      kind: 'InvalidInputValue'
      message: string
    }
  | {
      kind: 'MissingFullTextSearchIndex'
    }
  | {
      kind: 'SocketTimeout'
    }
  | {
      kind: 'InconsistentColumnData'
      cause: string
    }
  | {
      kind: 'TransactionAlreadyClosed'
      cause: string
    }
  | {
      kind: 'postgres'
      code: string
      severity: string
      message: string
      detail: string | undefined
      column: string | undefined
      hint: string | undefined
    }
  | {
      kind: 'mysql'
      code: number
      message: string
      state: string
      cause?: string
    }
  | {
      kind: 'sqlite'
      /**
       * Sqlite extended error code: https://www.sqlite.org/rescode.html
       */
      extendedCode: number
      message: string
    }
  | {
      kind: 'mssql'
      code: number
      message: string
    }

export type ConnectionInfo = {
  schemaName?: string
  maxBindValues?: number
  supportsRelationJoins: boolean
  serverAddress?: string
  serverPort?: number
}

export type Provider = 'mysql' | 'postgres' | 'sqlite' | 'sqlserver'

// Current list of official Prisma adapters
// This list might get outdated over time.
// It's only used for auto-completion and tests.
const officialPrismaAdapters = [
  '@prisma/adapter-planetscale',
  '@prisma/adapter-neon',
  '@prisma/adapter-libsql',
  '@prisma/adapter-better-sqlite3',
  '@prisma/adapter-d1',
  '@prisma/adapter-pg',
  '@prisma/adapter-mssql',
  '@prisma/adapter-mariadb',
] as const

export type OfficialDriverAdapterName = (typeof officialPrismaAdapters)[number]

/**
 * A generic driver adapter factory that allows the user to instantiate a
 * driver adapter. The query and result types are specific to the adapter.
 */
export interface DriverAdapterFactory<Query, Result> extends AdapterInfo {
  /**
   * Instantiate a driver adapter.
   */
  connect(): Promise<Queryable<Query, Result>>
}

export interface SqlDriverAdapterFactory extends DriverAdapterFactory<SqlQuery, SqlResultSet> {
  connect(): Promise<SqlDriverAdapter>
}

/**
 * An SQL migration adapter that is aware of the notion of a shadow database
 * and can create a connection to it.
 */
export interface SqlMigrationAwareDriverAdapterFactory extends SqlDriverAdapterFactory {
  connectToShadowDb(): Promise<SqlDriverAdapter>
}

export interface Queryable<Query, Result> extends AdapterInfo {
  /**
   * Execute a query and return its result.
   */
  queryRaw(params: Query): Promise<Result>

  /**
   * Execute a query and return the number of affected rows.
   */
  executeRaw(params: Query): Promise<number>
}

export interface SqlQueryable extends Queryable<SqlQuery, SqlResultSet> {}

export interface SqlDriverAdapter extends SqlQueryable {
  /**
   * Execute multiple SQL statements separated by semicolon.
   */
  executeScript(script: string): Promise<void>

  /**
   * Start new transaction.
   */
  startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction>

  /**
   * Optional method that returns extra connection info
   */
  getConnectionInfo?(): ConnectionInfo

  /**
   * Dispose of the connection and release any resources.
   */
  dispose(): Promise<void>
}

export type TransactionOptions = {
  usePhantomQuery: boolean
}

export interface Transaction extends AdapterInfo, SqlQueryable {
  /**
   * Transaction options.
   */
  readonly options: TransactionOptions
  /**
   * Commit the transaction.
   */
  commit(): Promise<void>
  /**
   * Roll back the transaction.
   */
  rollback(): Promise<void>
  /**
   * Creates a savepoint within the currently running transaction.
   */
  createSavepoint?(name: string): Promise<void>
  /**
   * Rolls back transaction state to a previously created savepoint.
   */
  rollbackToSavepoint?(name: string): Promise<void>
  /**
   * Releases a previously created savepoint. Optional because not every connector supports this operation.
   */
  releaseSavepoint?(name: string): Promise<void>
}

/**
 * An interface that exposes some basic information about the
 * adapter like its name and provider type.
 */
export interface AdapterInfo {
  readonly provider: Provider
  readonly adapterName: (typeof officialPrismaAdapters)[number] | (string & {})
}

type ErrorCapturingFunction<T> = T extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<Result<ErrorCapturingInterface<R>>>
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Result<ErrorCapturingInterface<R>>
    : T

type ErrorCapturingInterface<T> = {
  [K in keyof T]: ErrorCapturingFunction<T[K]>
}

export interface ErrorCapturingSqlDriverAdapter extends ErrorCapturingInterface<SqlDriverAdapter> {
  readonly errorRegistry: ErrorRegistry
}

export interface ErrorCapturingSqlDriverAdapterFactory extends ErrorCapturingInterface<SqlDriverAdapterFactory> {
  readonly errorRegistry: ErrorRegistry
}

export interface ErrorCapturingSqlMigrationAwareDriverAdapterFactory
  extends ErrorCapturingInterface<SqlMigrationAwareDriverAdapterFactory> {
  readonly errorRegistry: ErrorRegistry
}

export type ErrorCapturingTransaction = ErrorCapturingInterface<Transaction>

export type ErrorCapturingSqlQueryable = ErrorCapturingInterface<SqlQueryable>

export interface ErrorRegistry {
  consumeError(id: number): ErrorRecord | undefined
}

export type ErrorRecord = { error: unknown }
