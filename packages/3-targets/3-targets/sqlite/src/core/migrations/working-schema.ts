import type { SchemaNodeRef } from '@internal/framework-components/control';
import { namingOf, namingOfLiveName } from '@internal/sql-schema-ir/naming';
import {
  PrimaryKey,
  RelationalSchemaNodeKind,
  SqlCheckConstraintIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import type { IndexReplacement, RenameTableCall } from './op-factory-call';

export interface SqliteTableRename {
  readonly from: string;
  readonly to: string;
}

type RefRewrite = (ref: SchemaNodeRef) => SchemaNodeRef;

function rewriteRefs(
  refs: readonly SchemaNodeRef[] | undefined,
  rewrite: RefRewrite,
): readonly SchemaNodeRef[] | undefined {
  return refs?.map(rewrite);
}

/**
 * Rewrites the step of `kind` and `id` in a ref that runs through the given table, and the table
 * step itself when `kind` is the table kind.
 */
function stepRewrite(tableName: string, kind: string, fromId: string, toId: string): RefRewrite {
  return (ref) => {
    const tableStep = ref[1];
    if (tableStep?.nodeKind !== RelationalSchemaNodeKind.table || tableStep.id !== tableName) {
      return ref;
    }
    return ref.map((step, index) =>
      index >= 1 && step.nodeKind === kind && step.id === fromId
        ? { nodeKind: kind, id: toId }
        : step,
    );
  };
}

function withIndex(index: SqlIndexIR, name: string, rewrite: RefRewrite): SqlIndexIR {
  const base = {
    naming: name === index.name ? namingOf(index.name, index.prefix) : namingOfLiveName(name),
    where: index.where,
    unique: index.unique,
    partial: index.partial,
    type: index.type,
    options: index.options,
    annotations: index.annotations,
    dependsOn: rewriteRefs(index.dependsOn, rewrite),
  };
  return new SqlIndexIR(
    index.expression !== undefined
      ? { ...base, expression: index.expression }
      : { ...base, columns: index.columns ?? [] },
  );
}

/** How one table is rebuilt: its name, where its foreign keys point, and its index names. */
interface TableEdit {
  readonly name: string;
  readonly referencedTable: (fk: SqlForeignKeyIR) => string;
  readonly indexName: (index: SqlIndexIR) => string;
}

function rebuildTable(table: SqlTableIR, edit: TableEdit, rewrite: RefRewrite): SqlTableIR {
  const { primaryKey } = table;
  return new SqlTableIR({
    name: edit.name,
    columns: table.columns,
    ...ifDefined(
      'primaryKey',
      primaryKey === undefined
        ? undefined
        : new PrimaryKey({
            columns: primaryKey.columns,
            ...ifDefined('name', primaryKey.name),
            ...ifDefined('dependsOn', rewriteRefs(primaryKey.dependsOn, rewrite)),
          }),
    ),
    uniques: table.uniques.map(
      (unique) =>
        new SqlUniqueIR({
          columns: unique.columns,
          ...ifDefined('name', unique.name),
          ...ifDefined('annotations', unique.annotations),
          ...ifDefined('dependsOn', rewriteRefs(unique.dependsOn, rewrite)),
        }),
    ),
    foreignKeys: table.foreignKeys.map(
      (fk) =>
        new SqlForeignKeyIR({
          columns: fk.columns,
          referencedTable: edit.referencedTable(fk),
          referencedColumns: fk.referencedColumns,
          ...ifDefined('referencedSchema', fk.referencedSchema),
          ...ifDefined('name', fk.name),
          ...ifDefined('onDelete', fk.onDelete),
          ...ifDefined('onUpdate', fk.onUpdate),
          ...ifDefined('annotations', fk.annotations),
          ...ifDefined('resolvedReferencedNamespace', fk.resolvedReferencedNamespace),
          ...ifDefined('dependsOn', rewriteRefs(fk.dependsOn, rewrite)),
        }),
    ),
    indexes: table.indexes.map((index) => withIndex(index, edit.indexName(index), rewrite)),
    ...ifDefined(
      'checks',
      table.checks?.map(
        (check) =>
          new SqlCheckConstraintIR({
            naming: namingOf(check.name, check.prefix),
            expression: check.expression,
            dependsOn: rewriteRefs(check.dependsOn, rewrite),
          }),
      ),
    ),
    ...ifDefined('annotations', table.annotations),
  });
}

/** Rebuilds every table: `editFor` returns the edit for a table, or `undefined` to keep it. */
function mapTables(
  schema: SqlSchemaIR,
  rewrite: RefRewrite,
  editFor: (table: SqlTableIR) => Partial<TableEdit> | undefined,
): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: Object.fromEntries(
      Object.values(schema.tables).map((table) => {
        const rebuilt = rebuildTable(
          table,
          {
            name: table.name,
            referencedTable: (fk) => fk.referencedTable,
            indexName: (index) => index.name,
            ...editFor(table),
          },
          rewrite,
        );
        return [rebuilt.name, rebuilt];
      }),
    ),
    ...ifDefined('annotations', schema.annotations),
  });
}

/**
 * The schema with one table under its new name. Foreign keys anywhere that reference the table
 * follow it, and every dependency that names it moves with it. Object names do not change. An
 * unnamed primary key, unique constraint or foreign key stays unnamed: SQLite gives such a
 * constraint no name, so an introspected schema has none either, and the planner never renames
 * one.
 */
export function renameTableInSqliteSchema(
  schema: SqlSchemaIR,
  rename: SqliteTableRename,
): SqlSchemaIR {
  const { from, to } = rename;
  const rewrite = stepRewrite(from, RelationalSchemaNodeKind.table, from, to);
  return mapTables(schema, rewrite, (table) => ({
    ...(table.name === from ? { name: to } : {}),
    referencedTable: (fk) => (fk.referencedTable === from ? to : fk.referencedTable),
  }));
}

function replaceIndex(schema: SqlSchemaIR, replacement: IndexReplacement): SqlSchemaIR {
  const { tableName, indexName: oldIndexName } = replacement.drop;
  const newIndexName = replacement.create.indexName;
  const rewrite = stepRewrite(
    tableName,
    RelationalSchemaNodeKind.index,
    `index:${oldIndexName}`,
    `index:${newIndexName}`,
  );
  return mapTables(schema, rewrite, (table) =>
    table.name === tableName
      ? { indexName: (index) => (index.name === oldIndexName ? newIndexName : index.name) }
      : undefined,
  );
}

/**
 * The schema a migration's renames have produced so far. The planner starts it from the schema it
 * plans from, a hand-written migration from its start contract; each rename call is computed
 * against `current` and then applied, so a later call sees the effect of an earlier one. An index
 * the rename replaces is applied as a rename of the index node, so it keeps its definition.
 */
export interface WorkingSchema {
  readonly current: SqlSchemaIR;
  apply(call: RenameTableCall): void;
}

/** The working schema of a plan or a migration, starting from `initial`. */
export function createWorkingSchema(initial: SqlSchemaIR): WorkingSchema {
  return new WorkingSchemaImpl(initial);
}

class WorkingSchemaImpl implements WorkingSchema {
  #current: SqlSchemaIR;

  constructor(initial: SqlSchemaIR) {
    this.#current = initial;
  }

  get current(): SqlSchemaIR {
    return this.#current;
  }

  apply(call: RenameTableCall): void {
    const renamed = renameTableInSqliteSchema(this.#current, {
      from: call.oldTableName,
      to: call.tableName,
    });
    this.#current = call.indexReplacements.reduce(replaceIndex, renamed);
  }
}
