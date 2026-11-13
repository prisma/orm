import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

export const postgresIsolationLevels = {
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable',
} as const;

export type PostgresIsolationLevel =
  (typeof postgresIsolationLevels)[keyof typeof postgresIsolationLevels];

export const postgresIsolationLevelSchema = type.enumerated(
  ...Object.values(postgresIsolationLevels),
);

export function validatePostgresIsolationLevel(value: unknown): PostgresIsolationLevel {
  const result = postgresIsolationLevelSchema(value);
  if (result instanceof type.errors) {
    throw structuredError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction isolation level', {
      why: result.summary,
      fix: 'Use ReadUncommitted, ReadCommitted, RepeatableRead, or Serializable.',
      meta: { argument: 'isolationLevel', received: value },
    });
  }
  return result;
}
