import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';

interface SqliteError extends Error {
  readonly code?: string;
  readonly errcode?: number;
  readonly errstr?: string;
}

// SQLite extended error code ranges (base code * 256 + extended)
// Base code 19 = SQLITE_CONSTRAINT
const SQLITE_CONSTRAINT_BASE = 19;
const SQLITE_CONSTRAINT_UNIQUE = 2067; // 19 + 8*256
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555; // 19 + 6*256
const SQLITE_CONSTRAINT_FOREIGNKEY = 787; // 19 + 3*256
const SQLITE_CONSTRAINT_NOTNULL = 1299; // 19 + 5*256
const SQLITE_CONSTRAINT_CHECK = 275; // 19 + 1*256

// Base code 5 = SQLITE_BUSY
const SQLITE_BUSY = 5;
// Base code 6 = SQLITE_LOCKED
const SQLITE_LOCKED = 6;
// Base code 14 = SQLITE_CANTOPEN
const SQLITE_CANTOPEN = 14;
// Base code 26 = SQLITE_NOTADB
const SQLITE_NOTADB = 26;

// node:sqlite's code for using a database or statement in the wrong state: a closed database, but
// also an unknown named parameter.
const INVALID_STATE_CODE = 'ERR_INVALID_STATE';

const GENERAL_ERROR_SQLSTATE = 'HY000';

function isConstraintError(errcode: number): boolean {
  return (errcode & 0xff) === SQLITE_CONSTRAINT_BASE;
}

function isBusyOrLocked(errcode: number): boolean {
  const base = errcode & 0xff;
  return base === SQLITE_BUSY || base === SQLITE_LOCKED;
}

function isOpenFailure(errcode: number): boolean {
  const base = errcode & 0xff;
  return base === SQLITE_CANTOPEN || base === SQLITE_NOTADB;
}

export function isSqliteError(error: unknown): error is SqliteError {
  if (!(error instanceof Error)) {
    return false;
  }
  return (error as SqliteError).code === 'ERR_SQLITE_ERROR';
}

/**
 * The one place the driver reads SQLite's message: SQLite reports which constraint failed only
 * in the text, as in "UNIQUE constraint failed: table.column".
 */
function constraintNameFromMessage(message: string): string | undefined {
  const match = /constraint failed: (.+)/.exec(message);
  return match?.[1];
}

function mapErrCodeToSqlState(errcode: number): string {
  switch (errcode) {
    case SQLITE_CONSTRAINT_UNIQUE:
    case SQLITE_CONSTRAINT_PRIMARYKEY:
      return '23505'; // unique_violation
    case SQLITE_CONSTRAINT_FOREIGNKEY:
      return '23503'; // foreign_key_violation
    case SQLITE_CONSTRAINT_NOTNULL:
      return '23502'; // not_null_violation
    case SQLITE_CONSTRAINT_CHECK:
      return '23514'; // check_violation
    default:
      if (isConstraintError(errcode)) {
        return '23000'; // integrity_constraint_violation
      }
      return GENERAL_ERROR_SQLSTATE;
  }
}

/**
 * Normalizes a node:sqlite error. `databaseClosedByDriver` says whether the driver closed the
 * database the failing call used; only then is a wrong-state error a closed-database connection error.
 */
export function normalizeSqliteError(
  error: unknown,
  databaseClosedByDriver: boolean,
): SqlQueryError | SqlConnectionError | Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  if (isSqliteError(error)) {
    const sqliteErr = error as SqliteError;
    const errcode = sqliteErr.errcode ?? 0;

    if (isBusyOrLocked(errcode)) {
      return new SqlConnectionError(error.message, {
        cause: error,
        transient: true,
      });
    }

    if (isOpenFailure(errcode)) {
      return new SqlConnectionError(error.message, {
        cause: error,
        transient: false,
      });
    }

    const sqlState = mapErrCodeToSqlState(errcode);
    const constraint = constraintNameFromMessage(error.message);

    return new SqlQueryError(error.message, {
      cause: error,
      sqlState,
      ...(constraint !== undefined ? { constraint } : {}),
    });
  }

  if ('code' in error && error.code === INVALID_STATE_CODE) {
    return databaseClosedByDriver
      ? new SqlConnectionError(error.message, { cause: error, transient: false })
      : new SqlQueryError(error.message, { cause: error, sqlState: GENERAL_ERROR_SQLSTATE });
  }

  return error;
}
