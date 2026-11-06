import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { CONTROL_TABLE_NAMES } from '@internal/target-mysql/control-tables';
import type {
  MysqlCatalogRows,
  MysqlColumnRow,
  MysqlConstraintRow,
  MysqlForeignKeyRow,
  MysqlIndexRow,
} from './introspection';

const TABLES = `SELECT TABLE_NAME AS table_name
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
  ORDER BY TABLE_NAME`;

const COLUMNS = `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
    ORDINAL_POSITION AS ordinal_position, COLUMN_DEFAULT AS column_default,
    IS_NULLABLE AS is_nullable, COLUMN_TYPE AS column_type, EXTRA AS extra
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  ORDER BY TABLE_NAME, ORDINAL_POSITION`;

const INDEXES = `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
    NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
    COLUMN_NAME AS column_name, EXPRESSION AS expression
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
  ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;

const CONSTRAINTS = `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
    CONSTRAINT_TYPE AS constraint_type
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()`;

const FOREIGN_KEYS = `SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS constraint_name,
    k.COLUMN_NAME AS column_name, k.ORDINAL_POSITION AS ordinal_position,
    NULLIF(k.REFERENCED_TABLE_SCHEMA, k.TABLE_SCHEMA) AS referenced_table_schema,
    k.REFERENCED_TABLE_NAME AS referenced_table_name,
    k.REFERENCED_COLUMN_NAME AS referenced_column_name,
    r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
    AND r.TABLE_NAME = k.TABLE_NAME
    AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
  WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`;

/** Reads the catalog rows of the connection's database, leaving out the runner's control tables. */
export async function readMysqlCatalog(
  driver: SqlControlDriverInstance<'mysql'>,
): Promise<MysqlCatalogRows> {
  const keep = <Row extends { readonly table_name: string }>(rows: readonly Row[]) =>
    rows.filter((row) => !CONTROL_TABLE_NAMES.has(row.table_name));
  const tables = await driver.query<{ table_name: string }>(TABLES);
  const columns = await driver.query<MysqlColumnRow>(COLUMNS);
  const indexes = await driver.query<MysqlIndexRow>(INDEXES);
  const constraints = await driver.query<MysqlConstraintRow>(CONSTRAINTS);
  const foreignKeys = await driver.query<MysqlForeignKeyRow>(FOREIGN_KEYS);
  return {
    tables: keep(tables.rows).map((row) => row.table_name),
    columns: keep(columns.rows),
    indexes: keep(indexes.rows),
    constraints: keep(constraints.rows),
    foreignKeys: keep(foreignKeys.rows),
  };
}
