import type { Contract } from '@internal/contract/types';
import { exactName, type SchemaTables } from '@internal/family-sql/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';

/**
 * The tables of a Postgres schema, addressed by `contract`'s namespace ids, each mapped to its DDL
 * schema.
 */
export function postgresSchemaTables(
  schema: PostgresDatabaseSchemaNode,
  contract: Contract<SqlStorage>,
): SchemaTables {
  const tablesIn = (namespaceId: string) =>
    schema.namespaces[resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId)]?.tables ??
    {};
  const tableIn = (namespaceId: string, table: string) => tablesIn(namespaceId)[table];
  const hasTable = (namespaceId: string, table: string) =>
    tableIn(namespaceId, table) !== undefined;
  return {
    sameName: exactName,
    hasTable,
    hasColumn: (namespaceId, table, column) =>
      Object.hasOwn(tableIn(namespaceId, table)?.columns ?? {}, column),
    tablesNamed: (namespaceId, table) =>
      Object.keys(tablesIn(namespaceId)).filter((existing) => exactName(existing, table)),
    columnsNamed: (namespaceId, table, column) =>
      Object.keys(tableIn(namespaceId, table)?.columns ?? {}).filter((existing) =>
        exactName(existing, column),
      ),
    hasNamespace: (namespaceId) => {
      const schemaName = resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId);
      return schema.existingSchemas.includes(schemaName);
    },
    namespacesWithTable: (table) =>
      Object.keys(contract.storage.namespaces).filter((namespaceId) =>
        hasTable(namespaceId, table),
      ),
  };
}
