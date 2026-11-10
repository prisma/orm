import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

export const postgresIsolationLevelSchema = type(
  "'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable'",
);

export type PostgresIsolationLevel = typeof postgresIsolationLevelSchema.infer;

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
