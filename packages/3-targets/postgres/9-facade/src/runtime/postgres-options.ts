import type { PostgresDriverCreateOptions } from '@internal/driver-postgres/runtime';
import type { SqlExecutionOptions } from '@internal/sql-runtime';
import {
  type PostgresIsolationLevel,
  postgresIsolationLevelSchema,
} from '@internal/target-postgres/runtime';
import { ifDefined } from '@internal/utils/defined';
import { type } from 'arktype';
import { postgresError } from '../errors';
import type { PostgresTargetId } from './postgres-target-id';

type PostgresDriverCursorOptions = NonNullable<PostgresDriverCreateOptions['cursor']>;

/**
 * Default time to wait for the database to accept a connection, for a client's pool and for a
 * connection's `pg.Client`.
 */
export const DEFAULT_CONNECT_TIMEOUT_MILLIS = 20_000;

/** Timeouts for the pool a client creates from a url. */
export interface PostgresPoolOptions {
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}

/**
 * Server-side cursor for reads. Unset reads the whole result before the first row; set streams
 * rows in batches of `batchSize`, 100 when omitted or `undefined`. A `batchSize` that is not a
 * positive integer fails the factory call.
 */
export interface PostgresCursorOptions {
  readonly batchSize?: number | undefined;
}

/**
 * The options `postgres()` and `postgresServerless()` share: how queries run, not where the
 * database is.
 */
export interface PostgresExecutionOptions extends SqlExecutionOptions<PostgresTargetId> {
  readonly cursor?: PostgresCursorOptions;
  /**
   * Where statements from `prepare()` are prepared. Defaults to `"database"`.
   * `"client"` keeps framework-level pre-lowering and reuse but opts out of database-level prepared statements, for poolers that do not support them.
   */
  readonly prepare?: 'client' | 'database' | undefined;
  readonly transactionOptions?: PostgresTransactionOptions | undefined;
}

export interface PostgresTransactionOptions {
  readonly isolationLevel?: PostgresIsolationLevel | undefined;
  readonly timeout?: number | null | undefined;
}

const transactionOptionsSchema = type({
  'isolationLevel?': postgresIsolationLevelSchema.or('undefined'),
  'timeout?': '1 <= number.integer <= 2147483647 | null | undefined',
}).onUndeclaredKey('reject');

export function validateTransactionOptions(
  options: PostgresTransactionOptions | undefined,
): PostgresTransactionOptions | undefined {
  if (options === undefined) return undefined;
  const result = transactionOptionsSchema(options);
  if (result instanceof type.errors) {
    throw postgresError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction options', {
      why: result.summary,
      fix: 'Pass an isolationLevel of ReadUncommitted, ReadCommitted, RepeatableRead, or Serializable, or leave it unset. Timeout must be an integer from 1 to 2147483647 milliseconds; null disables it.',
      meta: { extension: 'postgres', argument: 'transactionOptions', received: options },
    });
  }
  return result;
}

const cursorOptionsSchema = type({
  'batchSize?': 'number.integer > 0 | undefined',
}).onUndeclaredKey('reject');

export function validateCursorOptions(
  cursor: PostgresCursorOptions | undefined,
  helper: string,
): PostgresCursorOptions | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const result = cursorOptionsSchema(cursor);
  if (result instanceof type.errors) {
    throw postgresError('RUNTIME.ARGUMENT_INVALID', 'Invalid cursor option', {
      why: result.summary,
      fix: 'Pass cursor: {} or cursor: { batchSize: <positive integer> } to read through a server-side cursor, or leave cursor unset to read without one.',
      meta: { extension: 'postgres', helper, argument: 'cursor', received: cursor },
    });
  }
  return result;
}

export function toDriverCursorOptions(
  cursor: PostgresCursorOptions | undefined,
): PostgresDriverCursorOptions {
  return cursor === undefined ? { disabled: true } : ifDefined('batchSize', cursor.batchSize);
}
