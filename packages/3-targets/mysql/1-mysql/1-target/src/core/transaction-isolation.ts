import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

export const mysqlIsolationLevels = {
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable',
} as const;

export type MysqlIsolationLevel = (typeof mysqlIsolationLevels)[keyof typeof mysqlIsolationLevels];

export const mysqlIsolationLevelSchema = type.enumerated(...Object.values(mysqlIsolationLevels));

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
