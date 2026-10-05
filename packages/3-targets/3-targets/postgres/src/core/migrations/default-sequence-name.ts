import { postgresObjectName } from './postgres-object-name';

/**
 * The name Postgres gives the sequence of a `SERIAL` column: `{table}_{column}_seq`, cut to fit 63 bytes as Postgres cuts it.
 */
export function defaultSequenceName(tableName: string, columnName: string): string {
  return postgresObjectName(tableName, columnName, 'seq');
}
