import { errorRuntime } from '@internal/errors/execution';
import { SqlQueryError } from '@internal/sql-errors';
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

/** The error a statement ends with when its connection is lost or closed under it. */
export function connectionLost(cause?: unknown): Error {
  return errorRuntime('DRIVER.NOT_CONNECTED', 'MySQL connection lost or closed', {
    why: cause instanceof Error ? cause.message : 'The connection ended.',
    fix: 'Retry the work; the driver opens a new connection.',
    ...(isMariadbError(cause)
      ? { meta: { errno: cause.errno, ...ifDefined('sqlState', cause.sqlState ?? undefined) } }
      : {}),
    ...(cause === undefined ? {} : { cause }),
  });
}

const ER_UNSUPPORTED_PS = 1295;
const ER_MAX_PREPARED_STMT_COUNT_REACHED = 1461;
const ER_GET_CONNECTION_TIMEOUT = 45028;
const ER_CANNOT_RETRIEVE_RSA_KEY = 45044;

/** What the driver adds to a server error whose cause lies in how the driver sends statements. */
const DETAIL: ReadonlyMap<number, string> = new Map([
  [
    ER_UNSUPPORTED_PS,
    'The runtime driver sends every statement as a server-side prepared statement, so values never travel inside the SQL, and MySQL refuses to prepare a few statements, such as LOCK TABLES and START TRANSACTION. Run such a statement outside the Prisma runtime.',
  ],
  [
    ER_MAX_PREPARED_STMT_COUNT_REACHED,
    'The server caps open prepared statements across all connections (max_prepared_stmt_count, 16,382 by default), and each connection keeps up to statementCacheSize of them open. Lower statementCacheSize or connectionLimit in the URL, run fewer processes against the server, or raise max_prepared_stmt_count.',
  ],
]);

const PUBLIC_KEY_FIX =
  'Add allowPublicKeyRetrieval=true to the URL, or connect over TLS with the ssl parameter. Fetching the key over plain TCP lets a machine between the client and the server pose as the server and read the password; TLS does not.';

/** The fix for a failed connection when the package's error names its cause, such as a sign-in that needs the server's public key. */
export function connectionFix(error: unknown): string | undefined {
  return isMariadbError(error) && error.errno === ER_CANNOT_RETRIEVE_RSA_KEY
    ? PUBLIC_KEY_FIX
    : undefined;
}

function publicKeyNeeded(error: MariadbError): Error {
  return errorRuntime('DRIVER.CONNECTION_FAILED', "MySQL sign-in needs the server's public key", {
    why: "The account signs in with caching_sha2_password or sha256_password, and the server asked for the full password exchange over a connection without TLS. Sending the password that way needs the server's public key, which the driver does not fetch unless the URL allows it. A sign-in can work while the server still has the account cached and fail after the server restarts.",
    fix: 'Add allowPublicKeyRetrieval=true to the URL, or connect over TLS with the ssl parameter. Fetching the key over plain TCP lets a machine between the client and the server pose as the server and read the password; TLS does not.',
    meta: { errno: error.errno },
    cause: error,
  });
}

function poolTimedOut(error: MariadbError): Error {
  const cause = error.cause;
  if (isMariadbError(cause) && cause.errno === ER_CANNOT_RETRIEVE_RSA_KEY) {
    return publicKeyNeeded(cause);
  }
  return errorRuntime(
    'DRIVER.CONNECTION_FAILED',
    'Timed out waiting for a pooled MySQL connection',
    {
      why:
        cause instanceof Error
          ? `The pool could not open a connection: ${cause.message}`
          : 'No connection was free within poolTimeout; every connection in the pool was in use.',
      fix: 'Check the URL and that the server is reachable; otherwise release held connections sooner, or raise connectionLimit or poolTimeout in the URL.',
      cause: error,
    },
  );
}

/**
 * An error from the `mariadb` package as the driver reports it: a sign-in that needs the server's public key, or a pool that gave no connection in time, as `DRIVER.CONNECTION_FAILED`; a lost connection as `DRIVER.NOT_CONNECTED`; an error MySQL reported as the family's `SqlQueryError` with its SQLSTATE; and any other error unchanged.
 */
export function normalizeMysqlError(error: unknown): unknown {
  if (!isMariadbError(error)) return error;
  if (error.errno === ER_CANNOT_RETRIEVE_RSA_KEY) return publicKeyNeeded(error);
  if (isFatal(error)) return connectionLost(error);
  if (error.errno === ER_GET_CONNECTION_TIMEOUT) return poolTimedOut(error);
  if (typeof error.sqlState !== 'string') return error;
  return new SqlQueryError(error.sqlMessage ?? error.message, {
    cause: error,
    sqlState: error.sqlState,
    ...ifDefined('detail', DETAIL.get(error.errno)),
  });
}
