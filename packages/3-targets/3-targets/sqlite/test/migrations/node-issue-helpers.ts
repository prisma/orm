/**
 * Test-only builders for hand-crafted node-typed schema-diff issues
 * (`SchemaDiffIssue`) over concrete SQLite schema-IR nodes. Used across the
 * issue-planner / planner-strategies / recreate-postcheck unit suites so
 * each test constructs real `SqlTableIR`/`SqlColumnIR`/... instances instead
 * of loose object literals, matching the shapes `diffSchemas` actually
 * produces.
 */

import type { ColumnDefault } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import {
  PrimaryKey,
  SqlCheckConstraintIR,
  SqlColumnDefaultIR,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';

/** The built-in SQLite codec whose data type is written as each native type; DDL is written from it. */
const CODEC_ID_BY_NATIVE_TYPE: Readonly<Record<string, string>> = {
  INTEGER: 'sqlite/integer@1',
  TEXT: 'sqlite/text@1',
  REAL: 'sqlite/real@1',
  BLOB: 'sqlite/blob@1',
};

function codecIdFor(nativeType: string): string {
  return CODEC_ID_BY_NATIVE_TYPE[nativeType.toUpperCase()] ?? 'test/native@1';
}

/**
 * An expected (desired-side) column, carrying the codec identity
 * (`codecRef` / `codecBaseNativeType`) the way derivation stamps it —
 * mirrors `contractToSchemaIR`'s output shape, so the node-based op-builders
 * (`column-ddl-rendering.ts`) resolve DDL from it exactly like a
 * derivation-produced tree.
 */
export function expectedColumn(input: {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly resolvedNativeType?: string;
  readonly many?: boolean;
  readonly resolvedDefault?: ColumnDefault;
}): SqlColumnIR {
  return new SqlColumnIR({
    name: input.name,
    nativeType: input.nativeType,
    nullable: input.nullable,
    resolvedNativeType: input.resolvedNativeType ?? input.nativeType,
    ...(input.many !== undefined ? { many: input.many } : {}),
    ...(input.resolvedDefault !== undefined ? { resolvedDefault: input.resolvedDefault } : {}),
    codecRef: {
      codecId: codecIdFor(input.nativeType),
      ...(input.many !== undefined ? { many: input.many } : {}),
    },
    codecBaseNativeType: input.nativeType,
  });
}

/** A live (actual-side) column, as introspection would build it — no codec identity. */
export function actualColumn(input: {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly resolvedNativeType?: string;
  readonly many?: boolean;
  readonly resolvedDefault?: ColumnDefault;
}): SqlColumnIR {
  return new SqlColumnIR({
    name: input.name,
    nativeType: input.nativeType,
    nullable: input.nullable,
    resolvedNativeType: input.resolvedNativeType ?? input.nativeType,
    ...(input.many !== undefined ? { many: input.many } : {}),
    ...(input.resolvedDefault !== undefined ? { resolvedDefault: input.resolvedDefault } : {}),
  });
}

export function primaryKey(columns: readonly string[]): PrimaryKey {
  return new PrimaryKey({ columns });
}

export function foreignKey(input: {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly onDelete?: SqlForeignKeyIR['onDelete'];
  readonly onUpdate?: SqlForeignKeyIR['onUpdate'];
}): SqlForeignKeyIR {
  return new SqlForeignKeyIR({
    columns: input.columns,
    referencedTable: input.referencedTable,
    referencedColumns: input.referencedColumns,
    resolvedReferencedNamespace: '',
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.onDelete !== undefined ? { onDelete: input.onDelete } : {}),
    ...(input.onUpdate !== undefined ? { onUpdate: input.onUpdate } : {}),
  });
}

export function columnDefault(input: {
  readonly resolved?: ColumnDefault;
  readonly raw?: string;
}): SqlColumnDefaultIR {
  return new SqlColumnDefaultIR({
    ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
    ...(input.raw !== undefined ? { raw: input.raw } : {}),
  });
}

export function checkConstraint(input: {
  readonly name: string;
  readonly expression: string;
}): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming: { kind: 'exact', name: input.name },
    expression: input.expression,
    dependsOn: undefined,
  });
}

export function unique(columns: readonly string[], name?: string): SqlUniqueIR {
  return new SqlUniqueIR({ columns, ...(name !== undefined ? { name } : {}) });
}

export function index(
  columns: readonly string[],
  overrides: { readonly name?: string; readonly unique?: boolean } = {},
): SqlIndexIR {
  return new SqlIndexIR({
    naming: { kind: 'exact', name: overrides.name ?? `idx_${columns.join('_')}` },
    columns,
    where: undefined,
    unique: overrides.unique ?? false,
    partial: false,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
  });
}

export function table(input: {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR>;
  readonly primaryKey?: PrimaryKey;
  readonly foreignKeys?: readonly SqlForeignKeyIR[];
  readonly uniques?: readonly SqlUniqueIR[];
  readonly indexes?: readonly SqlIndexIR[];
  readonly checks?: readonly SqlCheckConstraintIR[];
}): SqlTableIR {
  return new SqlTableIR({
    name: input.name,
    columns: input.columns,
    ...(input.primaryKey !== undefined ? { primaryKey: input.primaryKey } : {}),
    foreignKeys: input.foreignKeys ?? [],
    uniques: input.uniques ?? [],
    indexes: input.indexes ?? [],
    ...(input.checks !== undefined ? { checks: input.checks } : {}),
  });
}

/** Builds a `SchemaDiffIssue` directly — the shape `diffSchemas` produces, minus needing a real tree to diff. The change kind derives from presence: `expected` only is a create, `actual` only a drop, both an alter. */
export function issue(input: {
  readonly path: readonly string[];
  readonly expected?: unknown;
  readonly actual?: unknown;
}): SchemaDiffIssue {
  return {
    path: input.path,
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {}),
  } as SchemaDiffIssue;
}
