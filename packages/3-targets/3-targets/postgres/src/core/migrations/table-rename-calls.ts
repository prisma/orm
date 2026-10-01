import type { Contract } from '@internal/contract/types';
import type { MigrationOperationPolicy, ResolvedTableRename } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { assertDefined } from '@internal/utils/assertions';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { buildPostgresPlanDiff } from './diff-database-schema';
import { pairCheckRenames, pairIndexRenames } from './index-and-check-renames';
import { RenameTableCall } from './op-factory-call';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';
import { constraintRenamesForTableRename } from './table-rename-constraint-renames';
import { renameTableInPostgresSchema } from './working-schema';

const RENAME_POLICY: MigrationOperationPolicy = { allowedOperationClasses: ['widening'] };

export function emissionSchemaForNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): string {
  return namespaceId === UNBOUND_NAMESPACE_ID
    ? UNBOUND_NAMESPACE_ID
    : resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId);
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
  readonly rename: ResolvedTableRename;
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
