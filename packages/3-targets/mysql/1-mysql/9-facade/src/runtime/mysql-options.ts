import {
  type MysqlIsolationLevel,
  mysqlIsolationLevelSchema,
} from '@internal/target-mysql/runtime';
import { type } from 'arktype';
import { mysqlClientError } from '../errors';

export interface MysqlTransactionOptions {
  readonly isolationLevel?: MysqlIsolationLevel | undefined;
}

const transactionOptionsSchema = type({
  'isolationLevel?': mysqlIsolationLevelSchema.or('undefined'),
}).onUndeclaredKey('reject');

export function validateTransactionOptions(
  options: MysqlTransactionOptions | undefined,
): MysqlTransactionOptions | undefined {
  if (options === undefined) return undefined;
  const result = transactionOptionsSchema(options);
  if (result instanceof type.errors) {
    throw mysqlClientError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction options', {
      why: result.summary,
      fix: 'Pass an isolationLevel of ReadUncommitted, ReadCommitted, RepeatableRead, or Serializable, or leave it unset.',
      meta: { extension: 'mysql', argument: 'transactionOptions', received: options },
    });
  }
  return result;
}

const streamOptionSchema = type('boolean | undefined');

/** Checks `stream` when the factory is called, as the Postgres facade checks `cursor`. */
export function validateStreamOption(stream: boolean | undefined): boolean {
  const result = streamOptionSchema(stream);
  if (result instanceof type.errors) {
    throw mysqlClientError('RUNTIME.ARGUMENT_INVALID', 'Invalid stream option', {
      why: result.summary,
      fix: 'Pass stream: true to stream rows as they arrive, or leave stream unset to read each whole result first.',
      meta: { extension: 'mysql', helper: 'mysql', argument: 'stream', received: stream },
    });
  }
  return result ?? false;
}
