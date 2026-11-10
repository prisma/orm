import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

export const mysqlIsolationLevelSchema = type(
  "'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable'",
);

export type MysqlIsolationLevel = typeof mysqlIsolationLevelSchema.infer;

export function validateMysqlIsolationLevel(value: unknown): MysqlIsolationLevel {
  const result = mysqlIsolationLevelSchema(value);
  if (result instanceof type.errors) {
    throw structuredError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction isolation level', {
      why: result.summary,
      fix: 'Use ReadUncommitted, ReadCommitted, RepeatableRead, or Serializable.',
      meta: { argument: 'isolationLevel', received: value },
    });
  }
  return result;
}
