import type { PostgresDriverCreateOptions } from '@internal/driver-postgres/runtime';
import type { SqlExecutionOptions } from '@internal/sql-runtime';
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
