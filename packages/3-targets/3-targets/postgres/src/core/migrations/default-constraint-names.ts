/**
 * The names the planner gives a primary key, unique constraint or foreign key the contract leaves unnamed. They derive from the table name, so renaming the table leaves them stale until the planner renames them too. The planner writes unique constraint and foreign key names into the DDL whole, and Postgres cuts a name over 63 bytes the same way wherever it reads one, so those two need no cutting here.
 */
import { postgresObjectName } from './postgres-object-name';

/**
 * `{table}_pkey`, cut to fit 63 bytes as Postgres cuts the name of a primary key it names itself: `CREATE TABLE` writes an unnamed primary key, so a later drop or rename must find the name Postgres chose.
 */
export function defaultPrimaryKeyName(tableName: string): string {
  return postgresObjectName(tableName, undefined, 'pkey');
}

export function defaultUniqueName(tableName: string, columns: readonly string[]): string {
  return `${tableName}_${columns.join('_')}_key`;
}

export function defaultForeignKeyName(tableName: string, columns: readonly string[]): string {
  return `${tableName}_${columns.join('_')}_fkey`;
}
