import type { SqlMigrationPlanOperationStep } from '@internal/family-sql/control';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';

/**
 * A column as `pragma_table_info` reports it. SQLite keeps a column's declared type as written, so
 * the type the migration writes is compared with it.
 */
export interface ColumnShape {
  readonly name: string;
  readonly typeSql: string;
  readonly notNull: boolean;
  /** The column's 1-based position in the primary key, 0 when it is not part of it. */
  readonly primaryKeyPosition: number;
}

function text(value: string): string {
  return `'${escapeLiteral(value)}'`;
}

function columnRow(column: ColumnShape): string {
  return `(${text(column.name)}, ${text(column.typeSql.toLowerCase())}, ${column.notNull ? 1 : 0}, ${column.primaryKeyPosition})`;
}

/** Checks that the table has exactly these columns, each with its type, nullability and primary key position. */
export function tableColumnsCheck(
  tableName: string,
  columns: readonly ColumnShape[],
): SqlMigrationPlanOperationStep {
  const info = `pragma_table_info(${text(tableName)})`;
  return {
    description: `verify table "${tableName}" has exactly its columns`,
    sql:
      `SELECT (SELECT COUNT(*) FROM ${info}) = ${columns.length}` +
      ` AND (SELECT COUNT(*) FROM ${info} WHERE (name, LOWER(type), "notnull", pk) IN (VALUES ${columns.map(columnRow).join(', ')})) = ${columns.length}`,
  };
}

/** Checks the column's type and nullability. */
export function columnShapeCheck(
  tableName: string,
  column: { readonly name: string; readonly typeSql: string; readonly notNull: boolean },
): SqlMigrationPlanOperationStep {
  return {
    description: `verify column "${column.name}" on "${tableName}" has type ${column.typeSql} and ${column.notNull ? 'is required' : 'is optional'}`,
    sql: `SELECT COUNT(*) > 0 FROM pragma_table_info(${text(tableName)}) WHERE name = ${text(column.name)} AND LOWER(type) = ${text(column.typeSql.toLowerCase())} AND "notnull" = ${column.notNull ? 1 : 0}`,
  };
}

/** Checks that the column takes NULL, or that no row holds `value` in it. */
export function columnTakesNullOrValueAbsentCheck(
  tableName: string,
  columnName: string,
  value: string | number,
  description: string,
): SqlMigrationPlanOperationStep {
  return {
    description,
    sql: `SELECT (SELECT COUNT(*) > 0 FROM pragma_table_info(${text(tableName)}) WHERE name = ${text(columnName)} AND "notnull" = 0) OR NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} = ?1) AS result`,
    params: [value],
  };
}

/** Checks that the index is on the table, covers exactly these columns in this order, and is unique or not. */
export function indexDefinitionCheck(
  tableName: string,
  indexName: string,
  columns: readonly string[],
  unique: boolean,
): SqlMigrationPlanOperationStep {
  const positions = columns.map((column, seqno) => `(${seqno}, ${text(column)})`).join(', ');
  const info = `pragma_index_info(${text(indexName)})`;
  return {
    description: `verify index "${indexName}" on "${tableName}" covers (${columns.join(', ')})`,
    sql:
      `SELECT EXISTS (SELECT 1 FROM pragma_index_list(${text(tableName)}) WHERE name = ${text(indexName)} AND "unique" = ${unique ? 1 : 0})` +
      ` AND (SELECT COUNT(*) FROM ${info}) = ${columns.length}` +
      ` AND (SELECT COUNT(*) FROM ${info} WHERE (seqno, name) IN (VALUES ${positions})) = ${columns.length}`,
  };
}
