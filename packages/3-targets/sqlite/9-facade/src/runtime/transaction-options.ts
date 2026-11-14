import {
  type SqliteIsolationLevel,
  sqliteIsolationLevelSchema,
} from '@internal/target-sqlite/runtime';
import { type } from 'arktype';
import { sqliteError } from '../errors';

export interface SqliteTransactionOptions {
  readonly isolationLevel?: SqliteIsolationLevel | undefined;
  readonly timeout?: number | null | undefined;
}

const transactionOptionsSchema = type({
  'isolationLevel?': sqliteIsolationLevelSchema.or('undefined'),
  'timeout?': '1 <= number.integer <= 2147483647 | null | undefined',
}).onUndeclaredKey('reject');

export function validateTransactionOptions(
  options: SqliteTransactionOptions | undefined,
): SqliteTransactionOptions | undefined {
  if (options === undefined) return undefined;
  const result = transactionOptionsSchema(options);
  if (result instanceof type.errors) {
    throw sqliteError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction options', {
      why: result.summary,
      fix: 'Pass an isolationLevel of Serializable, or leave it unset. Timeout must be an integer from 1 to 2147483647 milliseconds; null disables it.',
      meta: { extension: 'sqlite', argument: 'transactionOptions', received: options },
    });
  }
  return result;
}
