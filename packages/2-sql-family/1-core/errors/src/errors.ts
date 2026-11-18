export interface SqlDriverError<Kind extends string> {
  readonly kind: Kind;
}
/**
 * SQL query error for query-related failures (syntax errors, constraint violations, permissions).
 */
export class SqlQueryError extends Error implements SqlDriverError<'sql_query'> {
  static readonly ERROR_NAME = 'SqlQueryError' as const;
  readonly kind = 'sql_query' as const;
  readonly sqlState: string | undefined;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly column: string | undefined;
  readonly detail: string | undefined;

  constructor(
    message: string,
    options?: {
      readonly cause?: Error;
      readonly sqlState?: string;
      readonly constraint?: string;
      readonly table?: string;
      readonly column?: string;
      readonly detail?: string;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = SqlQueryError.ERROR_NAME;
    this.sqlState = options?.sqlState;
    this.constraint = options?.constraint;
    this.table = options?.table;
    this.column = options?.column;
    this.detail = options?.detail;
  }

  /**
   * Type predicate to check if an error is a SqlQueryError.
   */
  static is(error: unknown): error is SqlQueryError {
    return (
      typeof error === 'object' &&
      error !== null &&
      Object.hasOwn(error, 'kind') &&
      (error as { kind: unknown }).kind === 'sql_query'
    );
  }
}

/**
 * SQLSTATE for a unique-constraint / primary-key violation — the SQL-standard
 * `unique_violation` class. Drivers normalize their target-specific codes (e.g.
 * Postgres `23505`, SQLite `SQLITE_CONSTRAINT_UNIQUE`/`PRIMARYKEY`) onto this
 * value on {@link SqlQueryError.sqlState}, so consumers classify violations
 * without knowing any target-specific error shape.
 */
export const UNIQUE_VIOLATION_SQLSTATE = '23505';

/**
 * Whether an error is a unique-constraint (or primary-key) violation, decided
 * solely from the driver-normalized {@link SqlQueryError.sqlState}. Raw driver
 * errors that were never normalized are not classified — callers run behind the
 * driver, which always normalizes before the error escapes.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return SqlQueryError.is(error) && error.sqlState === UNIQUE_VIOLATION_SQLSTATE;
}

/**
 * SQL connection error (timeouts, connection resets, etc.).
 */
export class SqlConnectionError extends Error implements SqlDriverError<'sql_connection'> {
  static readonly ERROR_NAME = 'SqlConnectionError' as const;
  readonly kind = 'sql_connection' as const;
  readonly transient: boolean | undefined;
  /** The SQLSTATE the server sent when it ended the connection, when there was one. */
  readonly sqlState: string | undefined;

  constructor(
    message: string,
    options?: {
      readonly cause?: Error;
      readonly transient?: boolean;
      readonly sqlState?: string;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = SqlConnectionError.ERROR_NAME;
    this.transient = options?.transient;
    this.sqlState = options?.sqlState;
  }

  /**
   * Type predicate to check if an error is a SqlConnectionError.
   */
  static is(error: unknown): error is SqlConnectionError {
    return (
      typeof error === 'object' &&
      error !== null &&
      Object.hasOwn(error, 'kind') &&
      (error as { kind: unknown }).kind === 'sql_connection'
    );
  }
}
