import { SqlConnectionError, SqlQueryError } from '@internal/sql-errors';
import { ifDefined } from '@internal/utils/defined';

/** The fields of the `mariadb` package's `SqlError` the driver reads. */
interface MariadbError extends Error {
  readonly errno: number;
  readonly sqlState?: string | null;
  readonly sqlMessage?: string | null;
  readonly fatal?: boolean;
}

function isMariadbError(error: unknown): error is MariadbError {
  return error instanceof Error && 'errno' in error && typeof error.errno === 'number';
}

/** Whether `error` left its connection unusable: the package marks a lost socket, and a server error of SQLSTATE class 08, as fatal. */
export function isFatal(error: unknown): boolean {
  return error instanceof Error && 'fatal' in error && error.fatal === true;
}

function serverMessage(error: Error): string {
  return isMariadbError(error) ? (error.sqlMessage ?? error.message) : error.message;
}

/** The error a statement ends with when its connection is lost or closed under it: a `SqlConnectionError` a retry on a new connection can get past, as on Postgres. */
export function connectionLost(cause: Error): SqlConnectionError {
  return new SqlConnectionError(serverMessage(cause), {
    cause,
    transient: true,
    ...ifDefined('sqlState', isMariadbError(cause) ? (cause.sqlState ?? undefined) : undefined),
  });
}

/** Node's socket and DNS error codes, and whether a retry can succeed after each, as the Postgres driver classifies them. */
const NODE_CONNECTION_CODES: ReadonlyMap<string, boolean> = new Map([
  ['ECONNRESET', true],
  ['ETIMEDOUT', true],
  ['EPIPE', true],
  ['EAI_AGAIN', true],
  ['ECONNREFUSED', false],
  ['ENOTFOUND', false],
  ['EHOSTUNREACH', false],
]);

/** Whether a retry can succeed after `error`, for a Node socket or DNS error; undefined for any other. */
function nodeConnectionTransience(error: unknown): boolean | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? NODE_CONNECTION_CODES.get(error.code)
    : undefined;
}

const ER_GET_CONNECTION_TIMEOUT = 45028;
const ER_INITIAL_SQL_ERROR = 45030;
const ER_CANNOT_RETRIEVE_RSA_KEY = 45044;

/** The errors MySQL refuses a sign-in with: access denied, access denied for a socket-authenticated account, and an authentication plugin the server has not loaded. Another attempt with the same URL fails the same way. */
const SIGN_IN_REFUSED: ReadonlySet<number> = new Set([1045, 1698, 1524]);

/** Whether `error` is one another attempt to connect with the same settings cannot get past: a refused connection, an unknown or unreachable host, a refused sign-in, a sign-in that needs the server's public key, or session setup MySQL refuses. */
export function connectingCannotSucceed(error: unknown): boolean {
  if (nodeConnectionTransience(error) === false) return true;
  return (
    isMariadbError(error) &&
    (SIGN_IN_REFUSED.has(error.errno) ||
      error.errno === ER_CANNOT_RETRIEVE_RSA_KEY ||
      error.errno === ER_INITIAL_SQL_ERROR)
  );
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

/** The SQLSTATE Postgres sends for each constraint MySQL reports under a shared SQLSTATE, as the SQLite driver maps its own codes, so a consumer such as `isUniqueConstraintViolation` reads them alike. */
const CONSTRAINT_SQLSTATES: ReadonlyMap<number, string> = new Map([
  [1062, UNIQUE_VIOLATION],
  [1586, UNIQUE_VIOLATION],
  [1216, FOREIGN_KEY_VIOLATION],
  [1217, FOREIGN_KEY_VIOLATION],
  [1451, FOREIGN_KEY_VIOLATION],
  [1452, FOREIGN_KEY_VIOLATION],
  [1048, NOT_NULL_VIOLATION],
  [3819, CHECK_VIOLATION],
]);

const PUBLIC_KEY_FIX =
  'Add allowPublicKeyRetrieval=true to the URL, or connect over TLS with sslmode or ssl=true in the URL. Fetching the key over plain TCP lets a machine between the client and the server pose as the server and read the password; TLS does not.';

/** The fix for a failed connection when the package's error names its cause, such as a sign-in that needs the server's public key. */
export function connectionFix(error: unknown): string | undefined {
  return isMariadbError(error) && error.errno === ER_CANNOT_RETRIEVE_RSA_KEY
    ? PUBLIC_KEY_FIX
    : undefined;
}

function publicKeyNeeded(error: MariadbError): SqlConnectionError {
  return new SqlConnectionError(
    `MySQL sign-in needs the server's public key: the account signs in with caching_sha2_password or sha256_password over a connection without TLS. ${PUBLIC_KEY_FIX}`,
    { cause: error, transient: false },
  );
}

function poolTimedOut(error: MariadbError): unknown {
  const cause = error.cause;
  if (connectingCannotSucceed(cause)) return normalizeMysqlError(cause);
  return new SqlConnectionError(
    cause instanceof Error
      ? `Timed out waiting for a pooled MySQL connection; the pool could not open one: ${serverMessage(cause)}`
      : 'Timed out waiting for a pooled MySQL connection; every connection in the pool was in use.',
    { cause: error, transient: true },
  );
}

/**
 * An error from the `mariadb` package as the driver reports it, in the family's types as the Postgres driver reports its own: a Node socket or DNS error as a `SqlConnectionError`, transient as the Postgres driver's table says; a lost connection and a pool that gave no connection in time as a transient `SqlConnectionError`; a sign-in that needs the server's public key, and session setup that fails, as a `SqlConnectionError` that is not transient; a sign-in MySQL refuses, as Postgres's 28P01, and an error MySQL reported about a statement as `SqlQueryError` with its SQLSTATE, a constraint violation with the SQLSTATE Postgres sends; and any other error unchanged. A pool that timed out because it could not connect in a way no retry can get past reports that error.
 */
export function normalizeMysqlError(error: unknown): unknown {
  const transient = nodeConnectionTransience(error);
  if (transient !== undefined && error instanceof Error) {
    return new SqlConnectionError(error.message, { cause: error, transient });
  }
  if (!isMariadbError(error)) return error;
  if (error.errno === ER_CANNOT_RETRIEVE_RSA_KEY) return publicKeyNeeded(error);
  if (error.errno === ER_INITIAL_SQL_ERROR) {
    return new SqlConnectionError(serverMessage(error), { cause: error, transient: false });
  }
  if (isFatal(error) && !SIGN_IN_REFUSED.has(error.errno)) return connectionLost(error);
  if (error.errno === ER_GET_CONNECTION_TIMEOUT) return poolTimedOut(error);
  if (typeof error.sqlState !== 'string') return error;
  return new SqlQueryError(error.sqlMessage ?? error.message, {
    cause: error,
    sqlState: CONSTRAINT_SQLSTATES.get(error.errno) ?? error.sqlState,
  });
}
