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

const ER_WRONG_ARGUMENTS = 1210;
const ER_UNSUPPORTED_PS = 1295;
const ER_MAX_PREPARED_STMT_COUNT_REACHED = 1461;
const ER_GET_CONNECTION_TIMEOUT = 45028;

function poolTimedOut(error: MariadbError): Error {
  const cause = error.cause;
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
 * An error from the `mariadb` package as the driver reports it: a lost connection as `DRIVER.NOT_CONNECTED`, a pool that gave no connection in time as `DRIVER.CONNECTION_FAILED`, an error MySQL reported as the family's `SqlQueryError` with its SQLSTATE, and any other error unchanged.
 */
export function normalizeMysqlError(error: unknown): unknown {
  if (!isMariadbError(error)) return error;
  if (isFatal(error)) return connectionLost(error);
  if (error.errno === ER_GET_CONNECTION_TIMEOUT) return poolTimedOut(error);
  if (typeof error.sqlState !== 'string') return error;
  return new SqlQueryError(error.sqlMessage ?? error.message, {
    cause: error,
    sqlState: error.sqlState,
  });
}

/**
 * A statement's error, by its error number: `DRIVER.PREPARE_FAILED` for a statement MySQL cannot prepare or for the server's limit on open prepared statements, `RUNTIME.ARGUMENT_INVALID` for a value MySQL refused for a placeholder, and otherwise {@link normalizeMysqlError}.
 */
export function statementError(error: unknown, sql: string): unknown {
  if (!isMariadbError(error)) return error;
  switch (error.errno) {
    case ER_UNSUPPORTED_PS:
      return errorRuntime(
        'DRIVER.PREPARE_FAILED',
        'MySQL cannot run this statement as a prepared statement',
        {
          why: 'The runtime driver sends every statement as a server-side prepared statement, so values never travel inside the SQL, and MySQL refuses to prepare a few statements, such as LOCK TABLES and START TRANSACTION.',
          fix: 'Run the statement outside the Prisma runtime.',
          meta: { sql },
          cause: error,
        },
      );
    case ER_MAX_PREPARED_STMT_COUNT_REACHED:
      return errorRuntime(
        'DRIVER.PREPARE_FAILED',
        'MySQL has reached its limit on open prepared statements',
        {
          why: 'Each connection keeps up to statementCacheSize prepared statements open, and the server caps them across all connections (max_prepared_stmt_count, 16,382 by default).',
          fix: 'Lower statementCacheSize or connectionLimit in the URL, run fewer processes against the server, or raise max_prepared_stmt_count on the server.',
          meta: { sql },
          cause: error,
        },
      );
    case ER_WRONG_ARGUMENTS:
      return errorRuntime('RUNTIME.ARGUMENT_INVALID', 'MySQL refused a value for a placeholder', {
        why: 'A placeholder MySQL reads as an integer, such as a LIMIT or OFFSET, received a value that is not one.',
        fix: 'Pass an integer.',
        meta: { sql },
        cause: error,
      });
    default:
      return normalizeMysqlError(error);
  }
}
