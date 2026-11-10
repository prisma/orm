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
 * The column's default and `EXTRA` as MySQL 8.4 reports them. MariaDB reports no default as the text `NULL`, a literal quoted, and a function such as `current_timestamp(3)` unquoted with no `DEFAULT_GENERATED` flag; an unquoted number is a literal on both servers.
 */
function mysqlDefault(row: MysqlColumnRow): Pick<MysqlColumnRow, 'column_default' | 'extra'> {
  const reported = row.column_default;
  if (reported === null || reported === 'NULL') return { column_default: null, extra: row.extra };
  const quoted = QUOTED.exec(reported);
  if (quoted !== null) return { column_default: unquoted(quoted[1] ?? ''), extra: row.extra };
  if (NUMBER.test(reported)) return { column_default: reported, extra: row.extra };
  return { column_default: reported, extra: withGeneratedFlag(row.extra) };
}

/** A MariaDB column row in the form MySQL 8.4 reports it, so MySQL's introspection reads it unchanged. */
export function asMysqlColumnRow(row: MysqlColumnRow): MysqlColumnRow {
  return { ...row, column_type: mysqlColumnType(row.column_type), ...mysqlDefault(row) };
}

/** Reads the MariaDB catalog of the driver's database and converts it to the rows MySQL 8.4 would report. */
export async function readMariadbCatalog(
  driver: SqlControlDriverInstance<string>,
): Promise<MysqlCatalogRows> {
  const catalog = await readMysqlCatalog(driver, MARIADB_CATALOG_QUERIES);
  return { ...catalog, columns: catalog.columns.map(asMysqlColumnRow) };
}
