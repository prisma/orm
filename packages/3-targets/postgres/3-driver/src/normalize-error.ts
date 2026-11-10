import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type ClientEventSource, hasLostConnection } from './pg-client-state';

/**
 * Postgres error shape from the pg library.
 *
 * Note: The pg library doesn't export a DatabaseError type or interface, but errors
 * thrown by pg.query() and pg.Client have this shape at runtime. We define this
 * interface to match the actual runtime structure documented in the pg library
 * (https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/errors.js).
 *
 * The @types/pg package also doesn't provide comprehensive error type definitions,
 * so we define our own interface based on the runtime error properties.
 */
interface PostgresError extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: string;
  readonly internalPosition?: string;
  readonly internalQuery?: string;
  readonly where?: string;
  readonly schema?: string;
  readonly file?: string;
  readonly line?: string;
  readonly routine?: string;
}

const NODE_CONNECTION_CODES: ReadonlyMap<string, boolean> = new Map([
  ['ECONNRESET', true],
  ['ETIMEDOUT', true],
  ['EPIPE', true],
  ['EAI_AGAIN', true],
  ['ECONNREFUSED', false],
  ['ENOTFOUND', false],
  ['EHOSTUNREACH', false],
]);

const TRANSIENT_CLASS_08_SQLSTATES: ReadonlySet<string> = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
]);

/**
 * SQLSTATEs outside class 08 that mean the server ended the session, and whether a retry on a
 * fresh connection can succeed. It cannot after 57P04, whose database is gone, nor after 25P03,
 * which ends a session inside an open transaction.
 */
const SESSION_ENDED_SQLSTATES: ReadonlyMap<string, boolean> = new Map([
  ['57P01', true],
  ['57P02', true],
  ['57P03', true],
  ['57P04', false],
  ['57P05', true],
  ['25P03', false],
]);

/** Whether a retry can succeed, for a SQLSTATE that means the connection failed; undefined for any other. */
function connectionSqlStateTransience(sqlState: string): boolean | undefined {
  if (sqlState.startsWith('08')) return TRANSIENT_CLASS_08_SQLSTATES.has(sqlState);
  return SESSION_ENDED_SQLSTATES.get(sqlState);
}

/**
 * PostgreSQL-specific error properties that indicate an error originated from pg library.
 * These properties are not present on Node.js system errors.
 * Excludes generic properties like 'detail', 'file', 'line', and 'position' that could appear on any error.
 */
const PG_ERROR_PROPERTIES = [
  'constraint',
  'table',
  'column',
  'hint',
  'internalPosition',
  'internalQuery',
  'where',
  'schema',
  'routine',
] as const;

/**
 * Type predicate to check if an error is a Postgres error from the pg library.
 *
 * Distinguishes pg library errors from Node.js system errors by checking for:
 * - SQLSTATE codes (5-character alphanumeric codes like '23505', '42601')
 * - pg-specific properties (constraint, table, column, hint, etc.) that Node.js errors don't have
 *
 * Node.js system errors (ECONNREFUSED, ETIMEDOUT, etc.) are excluded to prevent false positives.
 */
export function isPostgresError(error: unknown): error is PostgresError {
  if (!(error instanceof Error)) {
    return false;
  }

  const pgError = error as PostgresError;

  // Check for SQLSTATE code (5-character alphanumeric) - primary indicator of pg errors
  if (pgError.code && isPostgresSqlState(pgError.code)) {
    return true;
  }

  // Check for pg-specific properties that Node.js system errors don't have
  // These properties indicate the error originated from pg library query execution
  return PG_ERROR_PROPERTIES.some((prop) => pgError[prop] !== undefined);
}

/**
 * Checks if an error code is a Postgres SQLSTATE (5-character alphanumeric code).
 * SQLSTATE codes are standardized SQL error codes (e.g., '23505' for unique violation).
 */
function isPostgresSqlState(code: string | undefined): boolean {
  if (!code) {
    return false;
  }
  // Postgres SQLSTATE codes are 5-character alphanumeric strings
  // Examples: '23505' (unique violation), '42501' (insufficient privilege), '42601' (syntax error)
  return /^[A-Z0-9]{5}$/.test(code);
}

/**
 * Normalizes a Postgres error into a SQL-shared error type, from its code alone.
 *
 * - Connection SQLSTATEs (class `08`, and those that end the session) and Node socket codes → SqlConnectionError
 * - Other SQLSTATEs → SqlQueryError
 * - Errors already normalized, and errors without a recognized code → returned as-is
 *
 * pg raises some connection failures ("Connection terminated", "timeout expired") as plain
 * errors with no code; {@link normalizePgConnectFailure} classifies those where the caller
 * knows the connection failed.
 */
export function normalizePgErrorByCode(error: unknown): SqlQueryError | SqlConnectionError | Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  if (SqlQueryError.is(error) || SqlConnectionError.is(error)) {
    return error;
  }

  const pgError = blindCast<PostgresError, 'pg errors carry optional typed fields at runtime'>(
    error,
  );
  const code = pgError.code;
  if (code === undefined) {
    return error;
  }

  const transient = NODE_CONNECTION_CODES.get(code);
  if (transient !== undefined) {
    return new SqlConnectionError(error.message, { cause: error, transient });
  }

  if (isPostgresSqlState(code)) {
    const connectionTransience = connectionSqlStateTransience(code);
    if (connectionTransience !== undefined) {
      return new SqlConnectionError(error.message, {
        cause: error,
        transient: connectionTransience,
        sqlState: code,
      });
    }
    return new SqlQueryError(error.message, {
      cause: error,
      sqlState: code,
      ...ifDefined('constraint', pgError.constraint),
      ...ifDefined('table', pgError.table),
      ...ifDefined('column', pgError.column),
      ...ifDefined('detail', pgError.detail),
    });
  }

  return error;
}

/**
 * Normalizes an error the caller knows is a connection failure: it came from a `connect()`
 * call, or arrived after the client emitted `error` or `end`. Errors with a SQLSTATE keep
 * their code-based classification; everything else becomes a SqlConnectionError.
 */
export function normalizePgConnectFailure(error: unknown): SqlQueryError | SqlConnectionError {
  const normalized = normalizePgErrorByCode(error);
  if (SqlQueryError.is(normalized) || SqlConnectionError.is(normalized)) {
    return normalized;
  }
  return new SqlConnectionError(normalized.message, { cause: normalized });
}

/**
 * Normalizes an error from a query on `client`. pg raises the failures of a dead connection
 * ("Connection terminated", "not queryable") with no code, so once the client has emitted
 * `error` or `end` its errors are connection errors.
 */
export function normalizePgClientError(
  client: ClientEventSource,
  error: unknown,
): SqlQueryError | SqlConnectionError | Error {
  return hasLostConnection(client)
    ? normalizePgConnectFailure(error)
    : normalizePgErrorByCode(error);
}
