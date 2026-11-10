import type { MysqlColumnRow } from '@internal/adapter-mysql/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { asMysqlColumnRow, readMariadbCatalog } from '../src/core/migrations/catalog';

function column(
  columnType: string,
  columnDefault: string | null = null,
  extra = '',
): MysqlColumnRow {
  return {
    table_name: 'T',
    column_name: 'c',
    ordinal_position: '1',
    column_default: columnDefault,
    is_nullable: 'YES',
    column_type: columnType,
    extra,
  };
}

function converted(columnType: string, columnDefault: string | null = null, extra = '') {
  const row = asMysqlColumnRow(column(columnType, columnDefault, extra));
  return { type: row.column_type, default: row.column_default, extra: row.extra };
}

describe('converting a MariaDB column row to the form MySQL 8.4 reports', () => {
  it.each([
    ['int(11)', 'int'],
    ['int(10) unsigned', 'int unsigned'],
    ['bigint(20)', 'bigint'],
    ['bigint(20) unsigned', 'bigint unsigned'],
    ['smallint(6)', 'smallint'],
    ['mediumint(8) unsigned', 'mediumint unsigned'],
    ['tinyint(4)', 'tinyint'],
    ['tinyint(1) unsigned', 'tinyint unsigned'],
  ])('removes the display width of %s, as MySQL prints %s', (mariadb, mysql) => {
    expect(converted(mariadb).type).toBe(mysql);
  });

  it.each([
    'tinyint(1)',
    'int(5) unsigned zerofill',
    'tinyint(3) unsigned zerofill',
    'decimal(10,2)',
    'char(3)',
    'varchar(191)',
    'datetime(3)',
    "enum('int(11)','b')",
  ])('keeps %s, which MySQL prints the same way', (type) => {
    expect(converted(type).type).toBe(type);
  });

  it.each([
    ["'it''s'", "it's"],
    ["'it\\'s a \\\\ b'", "it's a \\ b"],
    ["'NULL'", 'NULL'],
    ["'USER'", 'USER'],
    ["'line\\nbreak'", 'line\nbreak'],
    ["''", ''],
    ["'100\\%'", '100\\%'],
  ])('unquotes the literal default %s', (mariadb, literal) => {
    expect(converted('varchar(191)', mariadb)).toEqual({
      type: 'varchar(191)',
      default: literal,
      extra: '',
    });
  });

  it.each(['0', '1.50', '-1', '2.5e3'])('keeps the unquoted number %s as a literal', (number) => {
    expect(converted('decimal(5,2)', number)).toEqual({
      type: 'decimal(5,2)',
      default: number,
      extra: '',
    });
  });

  it('reads the text NULL, which MariaDB reports for a nullable column with no default, as no default', () => {
    expect(converted('varchar(10)', 'NULL').default).toBeNull();
  });

  it('keeps no default as no default', () => {
    expect(converted('int(11)', null)).toEqual({ type: 'int', default: null, extra: '' });
  });

  it.each([
    ['datetime(3)', 'current_timestamp(3)'],
    ['datetime', 'current_timestamp()'],
    ['date', 'curdate()'],
  ])('marks the function default of a %s column, %s, as generated, as MySQL does', (type, fn) => {
    expect(converted(type, fn)).toEqual({ type, default: fn, extra: 'DEFAULT_GENERATED' });
  });

  it('keeps the rest of EXTRA after the generated flag', () => {
    expect(
      converted('datetime', 'current_timestamp()', 'on update current_timestamp()').extra,
    ).toBe('DEFAULT_GENERATED on update current_timestamp()');
  });

  it('leaves an auto_increment column as MariaDB reports it', () => {
    expect(converted('int(11)', null, 'auto_increment')).toEqual({
      type: 'int',
      default: null,
      extra: 'auto_increment',
    });
  });
});

describe('reading the MariaDB catalog', () => {
  it('reads indexes without STATISTICS.EXPRESSION, which MariaDB lacks, and converts each column row', async () => {
    const statements: string[] = [];
    const driver: SqlControlDriverInstance<'mariadb'> = {
      familyId: 'sql',
      targetId: 'mariadb',
      async query<Row>(sql: string) {
        statements.push(sql);
        const rows = sql.includes('information_schema.COLUMNS')
          ? [column('int(11)', "'7'"), { ...column('int(11)'), table_name: '_prisma_marker' }]
          : sql.includes('information_schema.TABLES')
            ? [{ table_name: 'T' }]
            : [];
        return { rows: rows as Row[] };
      },
      async close() {},
    };
    const catalog = await readMariadbCatalog(driver);
    const indexQuery = statements.find((sql) => sql.includes('information_schema.STATISTICS'));
    expect({
      tables: catalog.tables,
      columns: catalog.columns.map(({ column_type, column_default }) => ({
        column_type,
        column_default,
      })),
      readsExpression: indexQuery?.includes('EXPRESSION'),
      expressionIsNull: indexQuery?.includes('NULL AS expression'),
    }).toEqual({
      tables: ['T'],
      columns: [{ column_type: 'int', column_default: '7' }],
      readsExpression: false,
      expressionIsNull: true,
    });
  });
});
