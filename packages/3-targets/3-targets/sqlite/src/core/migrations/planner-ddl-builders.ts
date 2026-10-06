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
  dataTypeParams,
  renderSqlTypeName,
  type SqlTypeLookups,
  sqlDataTypeOfCodec,
} from '@internal/sql-contract/data-type';
import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import { SQLITE_DATETIME_CODEC_ID } from '../codec-ids';
import { decodeSqliteDatetime, encodeSqliteDatetime } from '../codecs';
import { sqliteInteger } from '../data-types';
import { sqliteError } from '../errors';
import { escapeLiteral, quoteIdentifier } from '../sql-utils';

/**
 * Renders the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`): the name the data type of its
 * codec is written with, in upper case. Resolves `typeRef` against `storageTypes`.
 */
export function buildColumnTypeSql(
  column: Pick<StorageColumn, 'codecId' | 'typeParams' | 'typeRef'>,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const dataType = sqlDataTypeOfCodec(resolved.codecId, types);
  return renderSqlTypeName(dataType, dataTypeParams(dataType, resolved.typeParams)).toUpperCase();
}

const DIGIT_TEXT = /^-?\d+$/;

/** The column a literal default is written for: its codec, and the data type that codec represents. */
export interface DefaultLiteralColumn {
  readonly codecId: string;
  readonly dataType: string;
}

/**
 * A literal default in SQL. An `integer` column stores digit text in the contract, which is written
 * as the integer it names. A datetime default is the stored value itself in SQLite, which compares
 * text byte by byte, so it is written as the text the column's codec writes for every row, not as
 * its canonical form.
 */
export function renderDefaultLiteral(value: unknown, column?: DefaultLiteralColumn): string {
  if (
    column?.dataType === sqliteInteger.id &&
    typeof value === 'string' &&
    DIGIT_TEXT.test(value)
  ) {
    return value;
  }
  if (value instanceof Date) {
    return `'${escapeLiteral(encodeSqliteDatetime(value))}'`;
  }
  if (typeof value === 'string' && column?.codecId === SQLITE_DATETIME_CODEC_ID) {
    return `'${escapeLiteral(encodeSqliteDatetime(decodeSqliteDatetime(value)))}'`;
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value === null) {
    return 'NULL';
  }
  return `'${escapeLiteral(JSON.stringify(value))}'`;
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
