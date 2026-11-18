import {
  MYSQL_CATALOG_QUERIES,
  type MysqlCatalogQueries,
  type MysqlCatalogRows,
  type MysqlColumnRow,
  readMysqlCatalog,
} from '@internal/adapter-mysql/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';

/** MySQL's catalog queries, with indexes read without `STATISTICS.EXPRESSION`: MariaDB has no functional indexes and no such column. */
export const MARIADB_CATALOG_QUERIES: MysqlCatalogQueries = {
  ...MYSQL_CATALOG_QUERIES,
  indexes: `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
    NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
    COLUMN_NAME AS column_name, NULL AS expression
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
  ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
};

const INTEGER_WITH_WIDTH = /^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/i;
const SIGNED_TINYINT_1 = /^tinyint\(1\)$/i;
const ZEROFILL = /\bzerofill\b/i;
const NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const QUOTED = /^'(.*)'$/s;
const BYTES_LITERAL = /^x'((?:[0-9a-f]{2})*)'$/i;
const DEFAULT_GENERATED = 'DEFAULT_GENERATED';

const ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
};

/** The column type as MySQL 8.4 prints it: without the display width of an integer type, except a signed `tinyint(1)` and a `zerofill` column, whose width MySQL keeps. */
function mysqlColumnType(columnType: string): string {
  if (SIGNED_TINYINT_1.test(columnType) || ZEROFILL.test(columnType)) return columnType;
  return columnType.replace(INTEGER_WITH_WIDTH, '$1');
}

/** The value of a quoted literal's body, with `''` and backslash escapes read as MariaDB reads them; `\%` and `\_` keep their backslash, as in any MySQL string literal. */
function unquoted(body: string): string {
  return body.replace(/''|\\(.)/gs, (_match, escaped: string | undefined) => {
    if (escaped === undefined) return "'";
    if (escaped === '%' || escaped === '_') return `\\${escaped}`;
    return ESCAPES[escaped] ?? escaped;
  });
}

function withGeneratedFlag(extra: string): string {
  return extra.length === 0 ? DEFAULT_GENERATED : `${DEFAULT_GENERATED} ${extra}`;
}

/**
 * The column's default and `EXTRA` as MySQL 8.4 reports them. MariaDB reports no default as the text `NULL`, a literal quoted, bytes as `X'00ff'`, which MySQL reports as the generated default `0x00ff`, and a function such as `current_timestamp(3)` unquoted with no `DEFAULT_GENERATED` flag; an unquoted number is a literal on both servers.
 */
function mysqlDefault(row: MysqlColumnRow): Pick<MysqlColumnRow, 'column_default' | 'extra'> {
  const reported = row.column_default;
  if (reported === null || reported === 'NULL') return { column_default: null, extra: row.extra };
  const quoted = QUOTED.exec(reported);
  if (quoted !== null) return { column_default: unquoted(quoted[1] ?? ''), extra: row.extra };
  if (NUMBER.test(reported)) return { column_default: reported, extra: row.extra };
  const bytes = BYTES_LITERAL.exec(reported)?.[1];
  if (bytes !== undefined) {
    return { column_default: `0x${bytes}`, extra: withGeneratedFlag(row.extra) };
  }
  return { column_default: reported, extra: withGeneratedFlag(row.extra) };
}

/** A MariaDB column row in the form MySQL 8.4 reports it, so MySQL's introspection reads it unchanged. */
export function asMysqlColumnRow(row: MysqlColumnRow): MysqlColumnRow {
  return { ...row, column_type: mysqlColumnType(row.column_type), ...mysqlDefault(row) };
}

/** The column-level CHECK constraints of the connection's database. MariaDB names a column's own check after the column. */
const COLUMN_CHECKS = `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
    CHECK_CLAUSE AS check_clause
  FROM information_schema.CHECK_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND LEVEL = 'Column'`;

interface ColumnCheckRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly check_clause: string;
}

const LONGTEXT = /^longtext$/i;

function columnKey(table: string, column: string): string {
  return JSON.stringify([table, column]);
}

/** The columns MariaDB created for a `json` column type: each has a column-level check, named after the column, that calls `json_valid` on the column. */
function jsonColumnsOf(checks: readonly ColumnCheckRow[]): ReadonlySet<string> {
  return new Set(
    checks
      .filter(
        (check) =>
          check.check_clause === `json_valid(\`${check.constraint_name.replaceAll('`', '``')}\`)`,
      )
      .map((check) => columnKey(check.table_name, check.constraint_name)),
  );
}

/**
 * MariaDB's `json` is another name for `longtext` with a column-level check `json_valid(col)`, and its catalog reports `longtext`. A `longtext` column with that check is reported as `json`, the type MySQL reports for the column the same `CREATE TABLE` makes; a hand-written `longtext … CHECK (json_valid(col))` is the same column.
 */
function asJsonColumn(row: MysqlColumnRow, jsonColumns: ReadonlySet<string>): MysqlColumnRow {
  return LONGTEXT.test(row.column_type) &&
    jsonColumns.has(columnKey(row.table_name, row.column_name))
    ? { ...row, column_type: 'json' }
    : row;
}

/** Reads the MariaDB catalog of the driver's database and converts it to the rows MySQL 8.4 would report. */
export async function readMariadbCatalog(
  driver: SqlControlDriverInstance<string>,
): Promise<MysqlCatalogRows> {
  const catalog = await readMysqlCatalog(driver, MARIADB_CATALOG_QUERIES);
  const checks = await driver.query<ColumnCheckRow>(COLUMN_CHECKS);
  const jsonColumns = jsonColumnsOf(checks.rows);
  return {
    ...catalog,
    columns: catalog.columns.map((row) => asJsonColumn(asMysqlColumnRow(row), jsonColumns)),
  };
}
