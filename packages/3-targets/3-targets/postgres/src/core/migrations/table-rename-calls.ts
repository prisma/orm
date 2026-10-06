import type { Contract } from '@internal/contract/types';
import {
  applyTableRename,
  type MigrationOperationPolicy,
  type ResolvedTableRename,
  type TableRename,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { assertDefined } from '@internal/utils/assertions';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { buildPostgresPlanDiff } from './diff-database-schema';
import { pairCheckRenames, pairIndexRenames } from './index-and-check-renames';
import { type PostgresOpFactoryCall, RenameTableCall } from './op-factory-call';
import { postgresContractToSchema } from './postgres-contract-to-schema';
import { renameRlsReferences } from './rename-rls-references';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';
import { constraintRenamesForTableRename } from './table-rename-constraint-renames';

const RENAME_POLICY: MigrationOperationPolicy = { allowedOperationClasses: ['widening'] };

export function emissionSchemaForNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): string {
  return namespaceId === UNBOUND_NAMESPACE_ID
    ? UNBOUND_NAMESPACE_ID
    : resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId);
}

function renamedTableNode(
  schema: PostgresDatabaseSchemaNode,
  contract: Contract<SqlStorage>,
  rename: ResolvedTableRename,
): PostgresTableSchemaNode {
  const ddlSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, rename.namespaceId);
  const table = Object.values(schema.namespaces).find(
    (namespace) => namespace.schemaName === ddlSchema,
  )?.tables[rename.to];
  assertDefined(table, `a resolved rename names table "${rename.to}" in schema "${ddlSchema}"`);
  return table;
}

/**
 * The calls a migration's `renameTable` emits: the table rename, then a rename of each primary key, unique constraint and foreign key the start contract left unnamed, and of each wire-named index and check whose prefix derives from the table name. Only objects the end contract leaves otherwise unchanged are renamed; an unchanged constraint takes the end contract's explicit name if it has one. Throws `MIGRATION.TABLE_RENAME_UNMATCHED` when the start contract lacks the table or the end contract lacks the new name.
 */
export function postgresTableRenameCalls(input: {
  readonly startContract: Contract<SqlStorage> | null;
  readonly endContract: Contract<SqlStorage>;
  readonly rename: TableRename;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): readonly PostgresOpFactoryCall[] {
  const applied = applyTableRename({
    startContract: input.startContract,
    endContract: input.endContract,
    rename: input.rename,
    renameTableReferences: renameRlsReferences,
  });
  if (!applied.ok) {
    throw applied.failure;
  }
  const { rename } = applied.value;
  const contract = input.endContract;
  const schemaName = emissionSchemaForNamespace(contract, rename.namespaceId);
  const previousSchema = postgresContractToSchema(
    applied.value.contract,
    input.frameworkComponents,
  );
  const nextSchema = postgresContractToSchema(contract, input.frameworkComponents);
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: previousSchema,
    frameworkComponents: input.frameworkComponents,
  });
  const onRenamedTable = (call: { readonly schemaName: string; readonly tableName: string }) =>
    call.schemaName === schemaName && call.tableName === rename.to;
  const pairing = { contract, policy: RENAME_POLICY };
  return [
    new RenameTableCall(schemaName, rename.from, rename.to),
    ...constraintRenamesForTableRename({
      schemaName,
      from: rename.from,
      to: rename.to,
      previous: renamedTableNode(previousSchema, contract, rename),
      next: renamedTableNode(nextSchema, contract, rename),
    }),
    ...pairIndexRenames(pairing, issues).calls.filter(onRenamedTable),
    ...pairCheckRenames(pairing, issues).calls.filter(onRenamedTable),
  ];
}
