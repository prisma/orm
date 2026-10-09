import type { Contract } from '@internal/contract/types';
import type {
  ColumnRename,
  MigrationOperationPolicy,
  TableRename,
  TableRenameRequest,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { assertDefined } from '@internal/utils/assertions';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { constraintRenamesForColumnRename } from './column-rename-constraint-renames';
import { buildPostgresPlanDiff } from './diff-database-schema';
import { pairCheckRenames, pairIndexRenames } from './index-and-check-renames';
import { RenameColumnCall, RenameTableCall } from './op-factory-call';
import { renameTableStatement } from './operations/tables';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';
import { constraintRenamesForTableRename } from './table-rename-constraint-renames';
import { renameColumnInPostgresSchema, renameTableInPostgresSchema } from './working-schema';

const RENAME_POLICY: MigrationOperationPolicy = { allowedOperationClasses: ['widening'] };

export function emissionSchemaForNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): string {
  return namespaceId === UNBOUND_NAMESPACE_ID
    ? UNBOUND_NAMESPACE_ID
    : resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId);
}

/**
 * The `renameTable` call a user writes in `migration.ts` for `rename`. `schema` names the namespace
 * the facade resolves the table in, and is left out for the unbound namespace or when not given.
 */
export function renderRenameTableCall(rename: TableRenameRequest): string {
  return new RenameTableCall(
    rename.namespaceId ?? UNBOUND_NAMESPACE_ID,
    rename.from,
    rename.to,
    [],
  ).renderTypeScript();
}

/** The SQL a user runs against the database to rename the table by hand. */
export function renameTableByHandStatements(
  contract: Contract<SqlStorage>,
  rename: TableRename,
): readonly string[] {
  return [
    renameTableStatement(
      emissionSchemaForNamespace(contract, rename.namespaceId),
      rename.from,
      rename.to,
    ),
  ];
}

function tableNode(
  schema: PostgresDatabaseSchemaNode,
  ddlSchema: string,
  tableName: string,
): PostgresTableSchemaNode {
  const table = schema.namespaces[ddlSchema]?.tables[tableName];
  assertDefined(table, `a resolved rename names table "${tableName}" in schema "${ddlSchema}"`);
  return table;
}

/**
 * The call that renames a table, carrying as companions the renames of the objects on the table
 * whose names derive from the table name: each primary key, unique constraint and foreign key the
 * destination keeps, named as the destination names it, and each wire-named index and check whose
 * prefix changes. `previous` is the schema before the rename; the renamed copy is diffed against
 * the destination built from `contract`.
 */
export function postgresTableRenameCall(input: {
  readonly previous: PostgresDatabaseSchemaNode;
  readonly contract: Contract<SqlStorage>;
  readonly rename: TableRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): RenameTableCall {
  const { contract, rename } = input;
  const schemaName = emissionSchemaForNamespace(contract, rename.namespaceId);
  const ddlSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, rename.namespaceId);
  const renamed = renameTableInPostgresSchema(input.previous, {
    schemaName: ddlSchema,
    from: rename.from,
    to: rename.to,
  });
  const { expected, issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: renamed,
    frameworkComponents: input.frameworkComponents,
  });
  const onRenamedTable = (call: { readonly schemaName: string; readonly tableName: string }) =>
    call.schemaName === schemaName && call.tableName === rename.to;
  const pairing = { contract, policy: RENAME_POLICY };
  return new RenameTableCall(schemaName, rename.from, rename.to, [
    ...constraintRenamesForTableRename({
      schemaName,
      previous: tableNode(renamed, ddlSchema, rename.to),
      next: tableNode(expected, ddlSchema, rename.to),
    }),
    ...pairIndexRenames(pairing, issues).calls.filter(onRenamedTable),
    ...pairCheckRenames(pairing, issues).calls.filter(onRenamedTable),
  ]);
}

/**
 * The call that renames a column, carrying as companions the renames of the objects on its table
 * whose names derive from the column name: each unique constraint and foreign key on the column
 * the destination keeps, named as the destination names it, and each index on the column renamed
 * to the destination's wire name. `previous` is the schema before the rename; the renamed copy is
 * diffed against the destination built from `contract`. A check on the column keeps its name: its
 * expression names the column, so the diff replaces it.
 */
export function postgresColumnRenameCall(input: {
  readonly previous: PostgresDatabaseSchemaNode;
  readonly contract: Contract<SqlStorage>;
  readonly rename: ColumnRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): RenameColumnCall {
  const { contract, rename } = input;
  const schemaName = emissionSchemaForNamespace(contract, rename.namespaceId);
  const ddlSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, rename.namespaceId);
  const renamed = renameColumnInPostgresSchema(input.previous, {
    schemaName: ddlSchema,
    table: rename.table,
    from: rename.from,
    to: rename.to,
  });
  const { expected, issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: renamed,
    frameworkComponents: input.frameworkComponents,
  });
  const table = tableNode(renamed, ddlSchema, rename.table);
  const destination = expected.namespaces[ddlSchema]?.tables[rename.table];
  const indexesOnColumn = new Set(
    table.indexes.filter((index) => index.columns?.includes(rename.to)).map((index) => index.name),
  );
  const indexRenames = pairIndexRenames({ contract, policy: RENAME_POLICY }, issues).calls.filter(
    (call) =>
      call.schemaName === schemaName &&
      call.tableName === rename.table &&
      indexesOnColumn.has(call.oldIndexName),
  );
  return new RenameColumnCall(schemaName, rename.table, rename.from, rename.to, [
    ...(destination === undefined
      ? []
      : constraintRenamesForColumnRename({
          schemaName,
          column: rename.to,
          previous: table,
          next: destination,
        })),
    ...indexRenames,
  ]);
}
