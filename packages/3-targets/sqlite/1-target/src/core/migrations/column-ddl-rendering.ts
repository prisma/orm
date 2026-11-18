import { dataTypeParams } from '@internal/framework-components/codec';
import {
  isSqlDataType,
  nameIsCatalogText,
  renderSqlTypeName,
} from '@internal/sql-contract/data-type';
import {
  DdlColumn,
  type DdlTableConstraint,
  ForeignKeyConstraint,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@internal/sql-relational-core/ast';
import type { SqlColumnIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { sqliteError } from '../errors';
import {
  INLINE_AUTOINCREMENT_PRIMARY_KEY,
  type SqliteColumnSpec,
  sqliteDefaultToDdlColumnDefault,
} from './operations/shared';

/**
 * The type DDL writes for a column node: the name of the type it is stored as, with the parameters as the contract writes them, in upper case, or as given for a data type whose name is its catalog text, since verify compares that text exactly (ADR 273).
 */
function columnTypeSql(column: SqlColumnIR): string {
  const type = column.storedType;
  if (type === undefined || !isSqlDataType(type)) {
    throw new InternalError(
      `column "${column.name}" has no data type; the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  const written = renderSqlTypeName(type, dataTypeParams(type, column.codecRef?.typeParams));
  return nameIsCatalogText(type) ? written : written.toUpperCase();
}

/** The default DDL writes: the one the contract authored; `resolvedDefault` exists for the diff comparison. */
function ddlDefaultOf(column: SqlColumnIR) {
  return column.authoredDefault ?? column.resolvedDefault;
}

/**
 * True when the column is rendered inline as `INTEGER PRIMARY KEY
 * AUTOINCREMENT` — the sole member of the table's primary key with an
 * `autoincrement()` default. Node-based sibling of the retired
 * `isInlineAutoincrementPrimaryKey` (which read the raw `StorageTable`);
 * reads the table/column nodes instead.
 */
export function isInlineAutoincrementPrimaryKeyNode(
  table: SqlTableIR,
  column: SqlColumnIR,
): boolean {
  if (table.primaryKey?.columns.length !== 1) return false;
  if (table.primaryKey.columns[0] !== column.name) return false;
  return (
    column.resolvedDefault?.kind === 'function' &&
    column.resolvedDefault.expression === 'autoincrement()'
  );
}

/**
 * Builds the flat `SqliteColumnSpec` `AddColumnCall` / `RecreateTableCall`
 * need, with the type the column is stored as.
 */
export function columnSpecFromNode(column: SqlColumnIR, inline: boolean): SqliteColumnSpec {
  const typeSql = columnTypeSql(column);
  return {
    name: column.name,
    typeSql,
    ...(inline
      ? {}
      : {
          ...ifDefined('default', ddlDefaultOf(column)),
          ...ifDefined('codecRef', column.codecRef),
        }),
    nullable: column.nullable,
    ...(inline ? { inlineAutoincrementPrimaryKey: true } : {}),
  };
}

/**
 * Builds the `DdlColumn` the `CreateTableCall` path needs, with the type the
 * column is stored as.
 */
export function ddlColumnFromNode(column: SqlColumnIR, inline: boolean): DdlColumn {
  const typeSql = columnTypeSql(column);
  if (inline) {
    // `DdlColumn` has no SQLite-specific autoincrement flag, so the full
    // `PRIMARY KEY AUTOINCREMENT` clause is embedded in the `type` string.
    // The DDL renderer (`ddl-renderer.ts`) substring-detects `AUTOINCREMENT`
    // to suppress the normal NOT NULL / PRIMARY KEY / DEFAULT clause rendering
    // and emit the entire type string verbatim. Both sites must stay in sync.
    // The structural fix (a SQLite-specific column option) is tracked in TML-2866.
    return new DdlColumn({
      name: column.name,
      type: `${typeSql}${INLINE_AUTOINCREMENT_PRIMARY_KEY}`,
    });
  }
  const colDefault = sqliteDefaultToDdlColumnDefault(ddlDefaultOf(column));
  return new DdlColumn({
    name: column.name,
    type: typeSql,
    ...(!column.nullable ? { notNull: true } : {}),
    ...(colDefault !== undefined ? { default: colDefault } : {}),
    ...(column.codecRef !== undefined ? { codecRef: column.codecRef } : {}),
  });
}

/**
 * Builds the table-level constraints (PK / unique / FK) for a `CreateTable`
 * path from the table node — the node-sourced sibling of the retired
 * contract-based `tableToDdlParts`'s constraint half.
 *
 * A check constraint on the table node throws rather than being dropped.
 * `@@check` is refused earlier, by the `sql.checkConstraint` capability gate in
 * PSL interpretation. The TS `check()` builder is not gated there — capabilities
 * are adapter-reported and reach the contract only after it is built — so a
 * `check()` declared against SQLite arrives here, and this is where it is
 * refused. It is the primary enforcement point for that surface, and the safety
 * net for a contract that reached storage some other way.
 */
export function tableConstraintsFromNode(
  table: SqlTableIR,
  hasInlinePk: boolean,
): DdlTableConstraint[] {
  const constraints: DdlTableConstraint[] = [];
  if (table.primaryKey && !hasInlinePk) {
    constraints.push(new PrimaryKeyConstraint({ columns: table.primaryKey.columns }));
  }
  for (const check of table.checks ?? []) {
    throw sqliteError(
      'CONTRACT.CONSTRAINT_INVALID',
      `The SQLite target does not support CHECK constraints (constraint "${check.name}" on table "${table.name}"). The "checkConstraint" capability is Postgres-only — remove the "@@check" / "check()" declaration, or target Postgres.`,
      { meta: { constraintName: check.name, tableName: table.name } },
    );
  }
  for (const u of table.uniques) {
    constraints.push(
      new UniqueConstraint({
        columns: u.columns,
        ...(u.name !== undefined ? { name: u.name } : {}),
      }),
    );
  }
  for (const fk of table.foreignKeys) {
    constraints.push(
      new ForeignKeyConstraint({
        columns: fk.columns,
        refTable: fk.referencedTable,
        refColumns: fk.referencedColumns,
        ...(fk.name !== undefined ? { name: fk.name } : {}),
        ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
        ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
      }),
    );
  }
  return constraints;
}
