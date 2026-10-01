import type { SchemaNodeRef } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { namingOf, namingOfLiveName, type SqlObjectNaming } from '@internal/sql-schema-ir/naming';
import {
  PrimaryKey,
  RelationalSchemaNodeKind,
  SqlCheckConstraintIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from './default-constraint-names';
import {
  RenameConstraintCall,
  RenameIndexCall,
  type RenamePostgresRlsPolicyCall,
  RenameTableCall,
} from './op-factory-call';

/**
 * A table rename inside one live schema: `schemaName` is the DDL schema name, never the unbound
 * sentinel.
 */
export interface SchemaTableRename {
  readonly schemaName: string;
  readonly from: string;
  readonly to: string;
}

export type WorkingSchemaCall =
  | RenameTableCall
  | RenameConstraintCall
  | RenameIndexCall
  | RenamePostgresRlsPolicyCall;

type RefRewrite = (ref: SchemaNodeRef) => SchemaNodeRef;

function ddlSchemaOf(callSchemaName: string): string {
  return callSchemaName === UNBOUND_NAMESPACE_ID ? DEFAULT_NAMESPACE_ID : callSchemaName;
}

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
function stepRewrite(
  schemaName: string,
  tableName: string,
  kind: string,
  fromId: string,
  toId: string,
): RefRewrite {
  return (ref) => {
    const namespaceStep = ref[1];
    const tableStep = ref[2];
    if (
      namespaceStep?.nodeKind !== PostgresSchemaNodeKind.namespace ||
      namespaceStep.id !== schemaName ||
      tableStep?.nodeKind !== PostgresSchemaNodeKind.table ||
      tableStep.id !== tableName
    ) {
      return ref;
    }
    return ref.map((step, index) =>
      index >= 2 && step.nodeKind === kind && step.id === fromId
        ? { nodeKind: kind, id: toId }
        : step,
    );
  };
}

function withPrimaryKey(
  primaryKey: PrimaryKey,
  name: string | undefined,
  rewrite: RefRewrite,
): PrimaryKey {
  return new PrimaryKey({
    columns: primaryKey.columns,
    ...ifDefined('name', name),
    ...ifDefined('dependsOn', rewriteRefs(primaryKey.dependsOn, rewrite)),
  });
}

function withUnique(
  unique: SqlUniqueIR,
  name: string | undefined,
  rewrite: RefRewrite,
): SqlUniqueIR {
  return new SqlUniqueIR({
    columns: unique.columns,
    ...ifDefined('name', name),
    ...ifDefined('annotations', unique.annotations),
    ...ifDefined('dependsOn', rewriteRefs(unique.dependsOn, rewrite)),
  });
}

function withForeignKey(
  fk: SqlForeignKeyIR,
  overrides: { readonly name: string | undefined; readonly referencedTable: string },
  rewrite: RefRewrite,
): SqlForeignKeyIR {
  return new SqlForeignKeyIR({
    columns: fk.columns,
    referencedTable: overrides.referencedTable,
    referencedColumns: fk.referencedColumns,
    ...ifDefined('referencedSchema', fk.referencedSchema),
    ...ifDefined('name', overrides.name),
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
    ...ifDefined('annotations', fk.annotations),
    ...ifDefined('resolvedReferencedNamespace', fk.resolvedReferencedNamespace),
    ...ifDefined('dependsOn', rewriteRefs(fk.dependsOn, rewrite)),
  });
}

function withIndex(index: SqlIndexIR, naming: SqlObjectNaming, rewrite: RefRewrite): SqlIndexIR {
  const base = {
    naming,
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

function withCheck(
  check: SqlCheckConstraintIR,
  naming: SqlObjectNaming,
  rewrite: RefRewrite,
): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming,
    expression: check.expression,
    dependsOn: rewriteRefs(check.dependsOn, rewrite),
  });
}

function withPolicy(
  policy: PostgresPolicySchemaNode,
  overrides: { readonly naming: SqlObjectNaming; readonly tableName: string },
  rewrite: RefRewrite,
): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    naming: overrides.naming,
    tableName: overrides.tableName,
    namespaceId: policy.namespaceId,
    operation: policy.operation,
    roles: policy.roles,
    using: policy.using,
    withCheck: policy.withCheck,
    permissive: policy.permissive,
    dependsOn: rewriteRefs(policy.dependsOn, rewrite),
  });
}

/**
 * How one table is rebuilt: each hook returns the replacement node, given the node and the rewrite
 * of its dependencies.
 */
interface TableEdit {
  readonly name: string;
  readonly primaryKeyName: (primaryKey: PrimaryKey) => string | undefined;
  readonly uniqueName: (unique: SqlUniqueIR) => string | undefined;
  readonly foreignKey: (fk: SqlForeignKeyIR) => {
    readonly name: string | undefined;
    readonly referencedTable: string;
  };
  readonly indexNaming: (index: SqlIndexIR) => SqlObjectNaming;
  readonly checkNaming: (check: SqlCheckConstraintIR) => SqlObjectNaming;
  readonly policy: (policy: PostgresPolicySchemaNode) => {
    readonly naming: SqlObjectNaming;
    readonly tableName: string;
  };
}

function unchangedEdit(table: PostgresTableSchemaNode): TableEdit {
  return {
    name: table.name,
    primaryKeyName: (primaryKey) => primaryKey.name,
    uniqueName: (unique) => unique.name,
    foreignKey: (fk) => ({ name: fk.name, referencedTable: fk.referencedTable }),
    indexNaming: (index) => namingOf(index.name, index.prefix),
    checkNaming: (check) => namingOf(check.name, check.prefix),
    policy: (policy) => ({
      naming: namingOf(policy.name, policy.prefix),
      tableName: policy.tableName,
    }),
  };
}

function rebuildTable(
  table: PostgresTableSchemaNode,
  edit: TableEdit,
  rewrite: RefRewrite,
): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: edit.name,
    columns: table.columns,
    ...ifDefined(
      'primaryKey',
      table.primaryKey === undefined
        ? undefined
        : withPrimaryKey(table.primaryKey, edit.primaryKeyName(table.primaryKey), rewrite),
    ),
    uniques: table.uniques.map((unique) => withUnique(unique, edit.uniqueName(unique), rewrite)),
    foreignKeys: table.foreignKeys.map((fk) => withForeignKey(fk, edit.foreignKey(fk), rewrite)),
    indexes: table.indexes.map((index) => withIndex(index, edit.indexNaming(index), rewrite)),
    ...ifDefined(
      'checks',
      table.checks?.map((check) => withCheck(check, edit.checkNaming(check), rewrite)),
    ),
    ...ifDefined('annotations', table.annotations),
    policies: table.policies.map((policy) => withPolicy(policy, edit.policy(policy), rewrite)),
    rlsEnabled: table.rlsEnabled,
  });
}

/**
 * Rebuilds every table of the schema: `editFor` returns the edit for a table, or `undefined` to
 * only rewrite its dependencies.
 */
function mapTables(
  schema: PostgresDatabaseSchemaNode,
  rewrite: RefRewrite,
  editFor: (schemaName: string, table: PostgresTableSchemaNode) => TableEdit | undefined,
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: Object.fromEntries(
      Object.entries(schema.namespaces).map(([key, namespace]) => [
        key,
        new PostgresNamespaceSchemaNode({
          schemaName: namespace.schemaName,
          nativeEnums: namespace.nativeEnums,
          tables: Object.fromEntries(
            Object.values(namespace.tables).map((table) => {
              const edit = editFor(namespace.schemaName, table) ?? unchangedEdit(table);
              const rebuilt = rebuildTable(table, edit, rewrite);
              return [rebuilt.name, rebuilt];
            }),
          ),
        }),
      ]),
    ),
    roles: schema.roles,
    existingSchemas: schema.existingSchemas,
    pgVersion: schema.pgVersion,
  });
}

/**
 * The schema with one table under its new name. Foreign keys anywhere that reference the table
 * follow it, its policies and every dependency that names it move with it, and row-level security
 * is carried. Constraint, index, check and policy names do not change: a primary key, unique
 * constraint or foreign key whose name was derived from the old table name gets that name spelled
 * out, since it no longer derives from the table it is on.
 */
export function renameTableInPostgresSchema(
  schema: PostgresDatabaseSchemaNode,
  rename: SchemaTableRename,
): PostgresDatabaseSchemaNode {
  const { schemaName, from, to } = rename;
  const rewrite = stepRewrite(schemaName, from, PostgresSchemaNodeKind.table, from, to);
  const referencesRenamed = (ownSchema: string, fk: SqlForeignKeyIR): boolean =>
    (fk.resolvedReferencedNamespace ?? ownSchema) === schemaName && fk.referencedTable === from;
  return mapTables(schema, rewrite, (tableSchema, table) => {
    const unchanged = unchangedEdit(table);
    const followReference = (fk: SqlForeignKeyIR) => ({
      name: fk.name,
      referencedTable: referencesRenamed(tableSchema, fk) ? to : fk.referencedTable,
    });
    if (tableSchema !== schemaName || table.name !== from) {
      return { ...unchanged, foreignKey: followReference };
    }
    return {
      ...unchanged,
      name: to,
      primaryKeyName: (primaryKey) => primaryKey.name ?? defaultPrimaryKeyName(from),
      uniqueName: (unique) => unique.name ?? defaultUniqueName(from, unique.columns),
      foreignKey: (fk) => ({
        ...followReference(fk),
        name: fk.name ?? defaultForeignKeyName(from, fk.columns),
      }),
      policy: (policy) => ({ ...unchanged.policy(policy), tableName: to }),
    };
  });
}

function renamedNaming(previous: { readonly prefix?: string | undefined }, name: string) {
  return previous.prefix === undefined ? namingOf(name, undefined) : namingOfLiveName(name);
}

function renameConstraint(
  schema: PostgresDatabaseSchemaNode,
  call: RenameConstraintCall,
): PostgresDatabaseSchemaNode {
  const schemaName = ddlSchemaOf(call.schemaName);
  const { tableName, oldConstraintName, newConstraintName } = call;
  const renamed = (name: string | undefined, derived: string) =>
    (name ?? derived) === oldConstraintName ? newConstraintName : name;
  const rewrite = stepRewrite(
    schemaName,
    tableName,
    RelationalSchemaNodeKind.check,
    `check:${oldConstraintName}`,
    `check:${newConstraintName}`,
  );
  return mapTables(schema, rewrite, (tableSchema, table) => {
    if (tableSchema !== schemaName || table.name !== tableName) return undefined;
    const unchanged = unchangedEdit(table);
    switch (call.kind) {
      case 'primaryKey':
        return {
          ...unchanged,
          primaryKeyName: (primaryKey) =>
            renamed(primaryKey.name, defaultPrimaryKeyName(tableName)),
        };
      case 'unique':
        return {
          ...unchanged,
          uniqueName: (unique) =>
            renamed(unique.name, defaultUniqueName(tableName, unique.columns)),
        };
      case 'foreignKey':
        return {
          ...unchanged,
          foreignKey: (fk) => ({
            referencedTable: fk.referencedTable,
            name: renamed(fk.name, defaultForeignKeyName(tableName, fk.columns)),
          }),
        };
      case 'checkConstraint':
        return {
          ...unchanged,
          checkNaming: (check) =>
            check.name === oldConstraintName
              ? renamedNaming(check, newConstraintName)
              : unchanged.checkNaming(check),
        };
    }
  });
}

function renameIndex(
  schema: PostgresDatabaseSchemaNode,
  call: RenameIndexCall,
): PostgresDatabaseSchemaNode {
  const schemaName = ddlSchemaOf(call.schemaName);
  const { tableName, oldIndexName, newIndexName } = call;
  const rewrite = stepRewrite(
    schemaName,
    tableName,
    RelationalSchemaNodeKind.index,
    `index:${oldIndexName}`,
    `index:${newIndexName}`,
  );
  return mapTables(schema, rewrite, (tableSchema, table) => {
    if (tableSchema !== schemaName || table.name !== tableName) return undefined;
    const unchanged = unchangedEdit(table);
    return {
      ...unchanged,
      indexNaming: (index) =>
        index.name === oldIndexName
          ? renamedNaming(index, newIndexName)
          : unchanged.indexNaming(index),
    };
  });
}

function renamePolicy(
  schema: PostgresDatabaseSchemaNode,
  call: RenamePostgresRlsPolicyCall,
): PostgresDatabaseSchemaNode {
  const schemaName = ddlSchemaOf(call.schemaName);
  const { tableName, oldPolicyName, newPolicyName } = call;
  const rewrite = stepRewrite(
    schemaName,
    tableName,
    PostgresSchemaNodeKind.policy,
    oldPolicyName,
    newPolicyName,
  );
  return mapTables(schema, rewrite, (tableSchema, table) => {
    if (tableSchema !== schemaName || table.name !== tableName) return undefined;
    const unchanged = unchangedEdit(table);
    return {
      ...unchanged,
      policy: (policy) =>
        policy.name === oldPolicyName
          ? { naming: renamedNaming(policy, newPolicyName), tableName: policy.tableName }
          : unchanged.policy(policy),
    };
  });
}

function applied(
  schema: PostgresDatabaseSchemaNode,
  call: WorkingSchemaCall,
): PostgresDatabaseSchemaNode {
  if (call instanceof RenameTableCall) {
    const renamed = renameTableInPostgresSchema(schema, {
      schemaName: ddlSchemaOf(call.schemaName),
      from: call.oldTableName,
      to: call.tableName,
    });
    return call.companions.reduce<PostgresDatabaseSchemaNode>(applied, renamed);
  }
  if (call instanceof RenameConstraintCall) return renameConstraint(schema, call);
  if (call instanceof RenameIndexCall) return renameIndex(schema, call);
  return renamePolicy(schema, call);
}

/**
 * The schema a migration's renames have produced so far. The planner starts it from the schema it
 * plans from, a hand-written migration from its start contract; each rename call is computed
 * against `current` and then applied, so a later call sees the effect of an earlier one.
 */
export interface WorkingSchema {
  readonly current: PostgresDatabaseSchemaNode;
  apply(call: WorkingSchemaCall): void;
}

/** The working schema of a plan or a migration, starting from `initial`. */
export function createWorkingSchema(initial: PostgresDatabaseSchemaNode): WorkingSchema {
  return new WorkingSchemaImpl(initial);
}

class WorkingSchemaImpl implements WorkingSchema {
  #current: PostgresDatabaseSchemaNode;

  constructor(initial: PostgresDatabaseSchemaNode) {
    this.#current = initial;
  }

  get current(): PostgresDatabaseSchemaNode {
    return this.#current;
  }

  apply(call: WorkingSchemaCall): void {
    this.#current = applied(this.#current, call);
  }
}
