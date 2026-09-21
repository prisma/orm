import type { StorageColumn } from '@internal/sql-contract/types';
import {
  DdlColumn,
  type DdlTableConstraint,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@internal/sql-relational-core/ast';
import type { SqlColumnIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { sqliteError } from '../errors';
import type { SqliteColumnSpec } from './operations/shared';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';

/**
 * Reconstructs the `StorageColumn`-shaped fields `buildColumnTypeSql` /
 * `buildColumnDefaultSql` expect, from a column node's own stamped codec
 * identity (`codecRef` / `codecBaseNativeType`, Decision 5) — never the
 * contract. SQLite's type renderer only uppercases the resolved base type
 * (no parameterized expansion, no named-type quoting), so `typeRef` is
 * deliberately left unset here: setting it would send `buildColumnTypeSql`
 * back through a live `storageTypes` lookup the node's fields have already
 * resolved past, which throws for an unrecognized reference (unlike
 * Postgres's lenient fallback).
 */
function columnLike(
  column: SqlColumnIR,
): Pick<StorageColumn, 'nativeType' | 'codecId' | 'nullable' | 'many' | 'typeParams' | 'default'> {
  if (column.codecRef === undefined || column.codecBaseNativeType === undefined) {
    throw new InternalError(
      `columnLike: expected column "${column.name}" carries no codec identity — the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  return {
    nativeType: column.codecBaseNativeType,
    codecId: column.codecRef.codecId,
    nullable: column.nullable,
    // `column.many` is unset on contract-derived columns (array-ness rides
    // on the `nativeType` `[]` suffix there instead) — `codecRef.many`
    // carries it. Hand-built/introspected columns set `column.many` directly.
    ...((column.many ?? column.codecRef.many) !== undefined
      ? { many: column.many ?? column.codecRef.many }
      : {}),
    ...(column.codecRef.typeParams !== undefined
      ? {
          typeParams: blindCast<
            Record<string, unknown>,
            'CodecRef.typeParams is JsonValue-shaped; the DDL builders only ever read it as the Record the contract column originally carried'
          >(column.codecRef.typeParams),
        }
      : {}),
    // DDL writes the default as authored; `resolvedDefault` exists for the diff comparison only.
    ...ifDefined('default', column.authoredDefault ?? column.resolvedDefault),
  };
}

function sqliteDefaultToDdlColumnDefault(
  columnDefault: StorageColumn['default'],
): DdlColumn['default'] {
  if (!columnDefault) return undefined;
  switch (columnDefault.kind) {
    case 'literal':
      return new LiteralColumnDefault(columnDefault.value);
    case 'function':
      // `autoincrement()` is not a DEFAULT clause — SQLite encodes it as
      // `INTEGER PRIMARY KEY AUTOINCREMENT` inline on the column. Skip it
      // here; the renderer also has a defensive guard for the same case.
      if (columnDefault.expression === 'autoincrement()') return undefined;
      return new FunctionColumnDefault(columnDefault.expression);
    default: {
      const exhaustive: never = columnDefault;
      return assertNever(
        exhaustive,
        `sqliteDefaultToDdlColumnDefault: unhandled kind "${blindCast<{ kind: string }, 'exhaustiveness: surface the unhandled default kind'>(exhaustive).kind}"`,
      );
    }
  }
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
 * need, resolved from the column node's codec identity — the same builders
 * the pre-`plan(start, end)` op-path called, so the output is
 * byte-identical.
 */
export function columnSpecFromNode(column: SqlColumnIR, inline: boolean): SqliteColumnSpec {
  const like = columnLike(column);
  const typeSql = buildColumnTypeSql(like, {});
  const defaultSql = buildColumnDefaultSql(like.default);
  return {
    name: column.name,
    typeSql,
    defaultSql,
    nullable: column.nullable,
    ...(inline ? { inlineAutoincrementPrimaryKey: true } : {}),
  };
}

/**
 * Builds the `DdlColumn` the `CreateTableCall` path needs, resolved from the
 * column node's codec identity.
 */
export function ddlColumnFromNode(column: SqlColumnIR, inline: boolean): DdlColumn {
  const like = columnLike(column);
  const typeSql = buildColumnTypeSql(like, {});
  if (inline) {
    // `DdlColumn` has no SQLite-specific autoincrement flag, so the full
    // `PRIMARY KEY AUTOINCREMENT` clause is embedded in the `type` string.
    // The DDL renderer (`ddl-renderer.ts`) substring-detects `AUTOINCREMENT`
    // to suppress the normal NOT NULL / PRIMARY KEY / DEFAULT clause rendering
    // and emit the entire type string verbatim. Both sites must stay in sync.
    // The structural fix (a SQLite-specific column option) is tracked in TML-2866.
    return new DdlColumn({ name: column.name, type: `${typeSql} PRIMARY KEY AUTOINCREMENT` });
  }
  const colDefault = sqliteDefaultToDdlColumnDefault(like.default);
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
