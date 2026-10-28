import { errorRuntime } from '@internal/errors/execution';
import { SqlQueryError } from '@internal/sql-errors';
import { ifDefined } from '@internal/utils/defined';

interface Mysql2Error extends Error {
  readonly sqlState?: string;
  readonly sqlMessage?: string;
}

function isMysql2Error(error: unknown): error is Mysql2Error {
  return error instanceof Error && 'sqlState' in error && typeof error.sqlState === 'string';
}

/** A query error MySQL reported, as the family's `SqlQueryError` with its SQLSTATE; any other error unchanged. */
export function normalizeMysqlError(error: unknown): unknown {
  if (!isMysql2Error(error)) return error;
  return new SqlQueryError(error.sqlMessage ?? error.message, {
    cause: error,
    ...ifDefined('sqlState', error.sqlState),
  });
}

/** Whether mysql2 reported `error` as fatal, which leaves its connection unusable. */
export function isFatal(error: unknown): error is Error {
  return error instanceof Error && 'fatal' in error && error.fatal === true;
}

/** The error a statement ends with when its connection is lost or closed under it. */
export function connectionLost(cause?: unknown): Error {
  return errorRuntime('DRIVER.NOT_CONNECTED', 'MySQL connection lost or closed', {
    why: cause instanceof Error ? cause.message : 'The connection ended.',
    fix: 'Retry the work; the driver opens a new connection.',
    ...(cause === undefined ? {} : { cause }),
  });
}

const ER_WRONG_ARGUMENTS = 1210;
const ER_UNSUPPORTED_PS = 1295;
const ER_MAX_PREPARED_STMT_COUNT_REACHED = 1461;

function errnoOf(error: unknown): unknown {
  return error instanceof Error && 'errno' in error ? error.errno : undefined;
}

/**
 * A statement's error, by MySQL's error number: `DRIVER.PREPARE_FAILED` for a statement MySQL cannot prepare or for the server's limit on open prepared statements, `RUNTIME.ARGUMENT_INVALID` for a value MySQL refused for a placeholder, such as a `LIMIT` that is not an integer, and otherwise the driver's usual normalization.
 */
export function statementError(error: unknown, sql: string): unknown {
  switch (errnoOf(error)) {
    case ER_UNSUPPORTED_PS:
      return errorRuntime(
        'DRIVER.PREPARE_FAILED',
        'MySQL cannot run this statement as a prepared statement',
        {
          why: 'The runtime driver sends every statement as a server-side prepared statement, so values never travel inside the SQL, and MySQL refuses to prepare a few statements, such as LOCK TABLES.',
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
          why: 'Every connection keeps up to statementCacheSize prepared statements open, and the server caps them across all connections (max_prepared_stmt_count, 16,382 by default).',
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
