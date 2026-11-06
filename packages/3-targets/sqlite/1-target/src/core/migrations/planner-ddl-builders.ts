import { dataTypeParams, type TypeLookups } from '@internal/framework-components/codec';
/**
 * Low-level DDL fragment builders for SQLite migrations.
 *
 * These helpers consume `StorageColumn` (the contract shape) and produce string fragments. They are called once per column at the call-construction boundary in `issue-planner.ts` / strategies to build flat `SqliteColumnSpec`s; the operation factories themselves never see `StorageColumn`.
 */

import { renderSqlTypeName, sqlStorageTypeOfCodec } from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { quoteIdentifier } from '../sql-utils';

/**
 * Renders the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`): the name the type its codec's
 * data type is stored as is written with, in upper case.
 */
export function buildColumnTypeSql(
  column: Pick<StorageColumn, 'codecId' | 'typeParams'>,
  types: TypeLookups,
): string {
  const storage = sqlStorageTypeOfCodec(column.codecId, types);
  return renderSqlTypeName(storage, dataTypeParams(storage, column.typeParams)).toUpperCase();
}

export function buildCreateIndexSql(
  tableName: string,
  indexName: string,
  columns: readonly string[],
  unique = false,
): string {
  const uniqueKeyword = unique ? 'UNIQUE ' : '';
  return `CREATE ${uniqueKeyword}INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')})`;
}

export function buildDropIndexSql(indexName: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`;
}

/**
 * True when the column is rendered inline as `INTEGER PRIMARY KEY
 * AUTOINCREMENT`. Requires the column's default to be `autoincrement()` and
 * the column to be the sole member of the table's primary key — anything
 * else falls back to a separate PRIMARY KEY constraint with a default
 * AUTOINCREMENT semantics expressed elsewhere.
 */
export function isInlineAutoincrementPrimaryKey(table: StorageTable, columnName: string): boolean {
  if (table.primaryKey?.columns.length !== 1) return false;
  if (table.primaryKey.columns[0] !== columnName) return false;
  const column = table.columns[columnName];
  return column?.default?.kind === 'function' && column.default.expression === 'autoincrement()';
}
