/**
 * Low-level DDL fragment builders for SQLite migrations.
 *
 * These helpers consume `StorageColumn` (the contract shape, possibly with
 * `typeRef`) and produce string fragments. They are called once per column
 * at the call-construction boundary in `issue-planner.ts` / strategies to
 * build flat `SqliteColumnSpec`s; the operation factories themselves never
 * see `StorageColumn` or `storageTypes`.
 */

import { checkSqlDefaultBody } from '@internal/family-sql/control';
import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import { sqliteError } from '../errors';
import { escapeLiteral, quoteIdentifier } from '../sql-utils';

type SqliteColumnDefault = StorageColumn['default'];

const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw sqliteError(
      'CONTRACT.NATIVE_TYPE_INVALID',
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*$/',
      { meta: { nativeType } },
    );
  }
}

function assertSafeDefaultExpression(expression: string): void {
  if (checkSqlDefaultBody(expression) !== undefined) {
    throw sqliteError(
      'CONTRACT.DEFAULT_INVALID',
      `Unsafe default expression in contract: "${expression}". ` +
        'Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
      { meta: { expression } },
    );
  }
}

/**
 * Renders the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`).
 * Resolves `typeRef` against `storageTypes` and validates the resulting
 * native type against a safe-identifier pattern.
 */
export function buildColumnTypeSql(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  assertSafeNativeType(resolved.nativeType);
  return resolved.nativeType.toUpperCase();
}

/**
 * Renders the column's `DEFAULT …` clause. Returns the empty string when
 * there is no default, and also when the default is `autoincrement()` —
 * SQLite encodes that as `INTEGER PRIMARY KEY AUTOINCREMENT` inline on the
 * column definition, not as a separate DEFAULT.
 */
export function buildColumnDefaultSql(columnDefault: SqliteColumnDefault | undefined): string {
  if (!columnDefault) return '';

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${renderDefaultLiteral(columnDefault.value)}`;
    case 'function': {
      if (columnDefault.expression === 'autoincrement()') return '';
      if (columnDefault.expression === 'now()') return "DEFAULT (datetime('now'))";
      assertSafeDefaultExpression(columnDefault.expression);
      return `DEFAULT (${columnDefault.expression})`;
    }
  }
}

export function renderDefaultLiteral(value: unknown): string {
  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
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

type ResolvedColumnTypeMetadata = Pick<StorageColumn, 'nativeType' | 'codecId' | 'typeParams'>;

export function resolveColumnTypeMetadata(
  column: StorageColumn,
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
    nativeType: referencedType.nativeType,
    typeParams: referencedType.typeParams,
  };
}
