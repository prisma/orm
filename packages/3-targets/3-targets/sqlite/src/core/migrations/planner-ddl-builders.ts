import { dataTypeParams } from '@internal/framework-components/codec';
/**
 * Low-level DDL fragment builders for SQLite migrations.
 *
 * These helpers consume `StorageColumn` (the contract shape, possibly with
 * `typeRef`) and produce string fragments. They are called once per column
 * at the call-construction boundary in `issue-planner.ts` / strategies to
 * build flat `SqliteColumnSpec`s; the operation factories themselves never
 * see `StorageColumn` or `storageTypes`.
 */

import {
  renderSqlTypeName,
  type SqlTypeLookups,
  sqlStorageTypeOfCodec,
} from '@internal/sql-contract/data-type';
import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import { sqliteError } from '../errors';
import { quoteIdentifier } from '../sql-utils';

/**
 * Renders the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`): the name the type its codec's
 * data type is stored as is written with, in upper case. Resolves `typeRef` against `storageTypes`.
 */
export function buildColumnTypeSql(
  column: Pick<StorageColumn, 'codecId' | 'typeParams' | 'typeRef'>,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const storage = sqlStorageTypeOfCodec(resolved.codecId, types);
  return renderSqlTypeName(storage, dataTypeParams(storage, resolved.typeParams)).toUpperCase();
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

type ResolvedColumnTypeMetadata = Pick<StorageColumn, 'codecId' | 'typeParams'>;

export function resolveColumnTypeMetadata(
  column: Pick<StorageColumn, 'codecId' | 'typeParams' | 'typeRef'>,
  storageTypes: Record<string, StorageTypeInstance>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }
  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    throw sqliteError(
      'CONTRACT.TYPE_UNKNOWN',
      `Storage type "${column.typeRef}" referenced by column is not defined in storage.types.`,
      { meta: { typeRef: column.typeRef } },
    );
  }
  return {
    codecId: referencedType.codecId,
    typeParams: referencedType.typeParams,
  };
}
