/**
 * Builds the schema IR of a MySQL database from the rows `information_schema` reports for it. The queries are in `introspection-queries.ts`; this module only maps rows, so it can be tested without a server.
 */

import type { ColumnDefault } from '@internal/contract/types';
import { resolveIntrospectedColumnType } from '@internal/family-sql/control-adapter';
import type { DataType } from '@internal/framework-components/codec';
import type { SchemaNodeRef } from '@internal/framework-components/control';
import type {
  PrimaryKeyInput,
  SqlColumnIRInput,
  SqlForeignKeyIRInput,
  SqlIndexIRInput,
  SqlReferentialAction,
  SqlUniqueIRInput,
} from '@internal/sql-schema-ir/types';
import { RelationalSchemaNodeKind, SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { readMysqlDefault } from '@internal/target-mysql/default-normalizer';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';

export interface MysqlColumnRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly ordinal_position: string;
  readonly column_default: string | null;
  readonly is_nullable: string;
  readonly column_type: string;
  readonly extra: string;
}

export interface MysqlIndexRow {
  readonly table_name: string;
  readonly index_name: string;
  readonly non_unique: string;
  readonly seq_in_index: string;
  readonly column_name: string | null;
  readonly expression: string | null;
}

export interface MysqlConstraintRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly constraint_type: string;
}

export interface MysqlForeignKeyRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly column_name: string;
  readonly ordinal_position: string;
  /** The referenced table's database, or `null` when it is the connection's own. */
  readonly referenced_table_schema: string | null;
  readonly referenced_table_name: string;
  readonly referenced_column_name: string;
  readonly update_rule: string;
  readonly delete_rule: string;
}

/** Everything introspection reads from `information_schema` for the connection's database. */
export interface MysqlCatalogRows {
  readonly tables: readonly string[];
  readonly columns: readonly MysqlColumnRow[];
  readonly indexes: readonly MysqlIndexRow[];
  readonly constraints: readonly MysqlConstraintRow[];
  readonly foreignKeys: readonly MysqlForeignKeyRow[];
}

/** The indexes the contract declares, which introspection tells apart from the ones MySQL reports on its own. */
export interface DeclaredIndexes {
  /** Whether the contract declares, on `tableName`, an index named `indexName`. */
  readonly declaresIndex: (tableName: string, indexName: string) => boolean;
  /** Whether the contract declares, on `tableName`, a unique index named `indexName`. */
  readonly declaresUniqueIndex: (tableName: string, indexName: string) => boolean;
}

const NOTHING_DECLARED: DeclaredIndexes = {
  declaresIndex: () => false,
  declaresUniqueIndex: () => false,
};

/** What a column's reported literal default reads as, through the codec of the column the contract declares. */
export type ReadLiteralDefault = (
  tableName: string,
  columnName: string,
  rawDefault: string,
) => Promise<Pick<SqlColumnIRInput, 'resolvedDefault' | 'defaultValue' | 'defaultUnreadable'>>;

const PRIMARY_INDEX = 'PRIMARY';

const REFERENTIAL_ACTIONS: Readonly<Record<string, SqlReferentialAction>> = {
  RESTRICT: 'restrict',
  CASCADE: 'cascade',
  'SET NULL': 'setNull',
  'SET DEFAULT': 'setDefault',
};

/** A rule `REFERENTIAL_CONSTRAINTS` reports, with `NO ACTION`, MySQL's default, as no action at all. */
function referentialAction(rule: string): SqlReferentialAction | undefined {
  const normalized = rule.toUpperCase();
  if (normalized === 'NO ACTION') return undefined;
  const action = REFERENTIAL_ACTIONS[normalized];
  if (action === undefined) {
    throw structuredError(
      'CONTRACT.INTROSPECTION_UNSUPPORTED',
      `Unknown MySQL referential action rule: "${rule}". Expected one of: NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT.`,
      { meta: { rule } },
    );
  }
  return action;
}

function tableDependsOn(tableName: string): SchemaNodeRef {
  return [
    { nodeKind: RelationalSchemaNodeKind.schema, id: 'database' },
    { nodeKind: RelationalSchemaNodeKind.table, id: tableName },
  ];
}

function columnDependsOn(tableName: string, columns: readonly string[]): SchemaNodeRef[] {
  return columns.map((column) => [
    ...tableDependsOn(tableName),
    { nodeKind: RelationalSchemaNodeKind.column, id: `column:${column}` },
  ]);
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

function byPosition<Row>(position: (row: Row) => string): (a: Row, b: Row) => number {
  return (a, b) => Number(position(a)) - Number(position(b));
}

async function columnOf(
  row: MysqlColumnRow,
  dataTypes: readonly DataType[],
  readLiteralDefault: ReadLiteralDefault,
): Promise<SqlColumnIRInput> {
  const reported = readMysqlDefault(row.column_default, row.extra);
  const readDefault: Pick<
    SqlColumnIRInput,
    'resolvedDefault' | 'defaultValue' | 'defaultUnreadable'
  > =
    reported === undefined
      ? {}
      : reported.kind === 'function'
        ? { resolvedDefault: reported satisfies ColumnDefault }
        : await readLiteralDefault(row.table_name, row.column_name, reported.literal.body);
  const reportedType = {
    text: row.column_type,
    kind: undefined,
    schema: undefined,
    name: undefined,
  };
  return {
    name: row.column_name,
    typeText: row.column_type,
    nullable: row.is_nullable === 'YES',
    ...ifDefined('default', row.column_default ?? undefined),
    ...readDefault,
    reportedType,
    ...resolveIntrospectedColumnType(reportedType, dataTypes),
  };
}

interface IndexShape {
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  readonly expression: string | undefined;
}

function indexesOf(rows: readonly MysqlIndexRow[]): IndexShape[] {
  return [...groupBy(rows, (row) => row.index_name).entries()].map(([name, parts]) => {
    const ordered = [...parts].sort(byPosition((part) => part.seq_in_index));
    const expressions = ordered.flatMap((part) =>
      part.expression === null ? [] : [part.expression],
    );
    return {
      name,
      unique: ordered[0]?.non_unique === '0',
      columns: ordered.flatMap((part) => (part.column_name === null ? [] : [part.column_name])),
      expression: expressions.length === 0 ? undefined : expressions.join(', '),
    };
  });
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index]);
}

function foreignKeysOf(
  tableName: string,
  rows: readonly MysqlForeignKeyRow[],
): SqlForeignKeyIRInput[] {
  return [...groupBy(rows, (row) => row.constraint_name).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, parts]) => {
      const ordered = [...parts].sort(byPosition((part) => part.ordinal_position));
      const [first] = ordered;
      const columns = ordered.map((part) => part.column_name);
      const referencedTable = first?.referenced_table_name ?? '';
      const referencedSchema = first?.referenced_table_schema ?? undefined;
      return {
        columns,
        referencedTable,
        referencedColumns: ordered.map((part) => part.referenced_column_name),
        ...ifDefined('referencedSchema', referencedSchema),
        name,
        ...ifDefined(
          'onDelete',
          first === undefined ? undefined : referentialAction(first.delete_rule),
        ),
        ...ifDefined(
          'onUpdate',
          first === undefined ? undefined : referentialAction(first.update_rule),
        ),
        dependsOn: [
          ...(referencedSchema === undefined ? [tableDependsOn(referencedTable)] : []),
          ...columnDependsOn(tableName, columns),
        ],
      };
    });
}

/**
 * The index InnoDB creates for a foreign key that no index already serves: it carries the key's name and exactly the key's columns. Introspection leaves it out, because the contract describes the key, not that index. An explicit index can look the same, so one the contract declares is kept.
 */
function isForeignKeyIndex(
  tableName: string,
  index: IndexShape,
  foreignKeys: readonly SqlForeignKeyIRInput[],
  declared: DeclaredIndexes,
): boolean {
  if (declared.declaresIndex(tableName, index.name)) return false;
  return foreignKeys.some(
    (fk) =>
      fk.name === index.name &&
      index.expression === undefined &&
      sameColumns(fk.columns, index.columns),
  );
}

async function tableOf(
  tableName: string,
  rows: {
    readonly columns: readonly MysqlColumnRow[];
    readonly indexes: readonly MysqlIndexRow[];
    readonly constraints: readonly MysqlConstraintRow[];
    readonly foreignKeys: readonly MysqlForeignKeyRow[];
  },
  dataTypes: readonly DataType[],
  readLiteralDefault: ReadLiteralDefault,
  declared: DeclaredIndexes,
): Promise<SqlTableIR> {
  const columns: Record<string, SqlColumnIRInput> = {};
  for (const row of [...rows.columns].sort(byPosition((column) => column.ordinal_position))) {
    columns[row.column_name] = await columnOf(row, dataTypes, readLiteralDefault);
  }

  const foreignKeys = foreignKeysOf(tableName, rows.foreignKeys);
  const indexes = indexesOf(rows.indexes);
  const expressionIndexNames = new Set(
    indexes.filter((index) => index.expression !== undefined).map((index) => index.name),
  );
  const uniqueConstraintNames = new Set(
    rows.constraints
      .filter(
        (constraint) =>
          constraint.constraint_type === 'UNIQUE' &&
          !expressionIndexNames.has(constraint.constraint_name) &&
          !declared.declaresUniqueIndex(tableName, constraint.constraint_name),
      )
      .map((constraint) => constraint.constraint_name),
  );

  const primary = indexes.find((index) => index.name === PRIMARY_INDEX);
  const primaryKey: PrimaryKeyInput | undefined =
    primary === undefined
      ? undefined
      : { columns: primary.columns, dependsOn: columnDependsOn(tableName, primary.columns) };

  const uniques: SqlUniqueIRInput[] = indexes
    .filter((index) => uniqueConstraintNames.has(index.name))
    .map((index) => ({
      columns: index.columns,
      name: index.name,
      dependsOn: columnDependsOn(tableName, index.columns),
    }));

  const plainIndexes: SqlIndexIRInput[] = indexes
    .filter(
      (index) =>
        index.name !== PRIMARY_INDEX &&
        !uniqueConstraintNames.has(index.name) &&
        !isForeignKeyIndex(tableName, index, foreignKeys, declared),
    )
    .map((index) => {
      const base = {
        naming: { kind: 'exact', name: index.name } as const,
        where: undefined,
        unique: index.unique,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: columnDependsOn(tableName, index.columns),
      };
      return index.expression === undefined
        ? { ...base, columns: index.columns }
        : { ...base, expression: index.expression };
    });

  return new SqlTableIR({
    name: tableName,
    columns,
    ...ifDefined('primaryKey', primaryKey),
    foreignKeys,
    uniques,
    indexes: plainIndexes,
  });
}

/**
 * The schema IR of the database the rows describe: one flat tree of its tables. MySQL lists every unique index as a UNIQUE constraint, so one is reported as a unique constraint unless the contract declares a unique index of that name on the table, or it indexes an expression. The index InnoDB creates for a foreign key is left out, unless the contract declares an index of that name on the table.
 */
export async function buildMysqlSchemaIR(
  rows: MysqlCatalogRows,
  dataTypes: readonly DataType[],
  readLiteralDefault: ReadLiteralDefault,
  declared: DeclaredIndexes = NOTHING_DECLARED,
): Promise<SqlSchemaIR> {
  const columnsByTable = groupBy(rows.columns, (row) => row.table_name);
  const indexesByTable = groupBy(rows.indexes, (row) => row.table_name);
  const constraintsByTable = groupBy(rows.constraints, (row) => row.table_name);
  const foreignKeysByTable = groupBy(rows.foreignKeys, (row) => row.table_name);
  const tables: Record<string, SqlTableIR> = {};
  for (const tableName of rows.tables) {
    tables[tableName] = await tableOf(
      tableName,
      {
        columns: columnsByTable.get(tableName) ?? [],
        indexes: indexesByTable.get(tableName) ?? [],
        constraints: constraintsByTable.get(tableName) ?? [],
        foreignKeys: foreignKeysByTable.get(tableName) ?? [],
      },
      dataTypes,
      readLiteralDefault,
      declared,
    );
  }
  return new SqlSchemaIR({ tables });
}
