import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

export const sqliteIsolationLevels = { Serializable: 'Serializable' } as const;

export type SqliteIsolationLevel =
  (typeof sqliteIsolationLevels)[keyof typeof sqliteIsolationLevels];

export const sqliteIsolationLevelSchema = type.enumerated(...Object.values(sqliteIsolationLevels));

export function validateSqliteIsolationLevel(value: unknown): SqliteIsolationLevel {
  const result = sqliteIsolationLevelSchema(value);
  if (result instanceof type.errors) {
    throw structuredError('RUNTIME.ARGUMENT_INVALID', 'Invalid transaction isolation level', {
      why: result.summary,
      fix: 'Use Serializable for SQLite transactions.',
      meta: { argument: 'isolationLevel', received: value },
    });
  }
  return result;
}
