import type { Contract } from '@internal/contract/types';
import type { SchemaTables } from '@internal/family-sql/control';
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
  const tableIn = (namespaceId: string, table: string) =>
    schema.namespaces[resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId)]?.tables[
      table
    ];
  const hasTable = (namespaceId: string, table: string) =>
    tableIn(namespaceId, table) !== undefined;
  return {
    hasTable,
    hasColumn: (namespaceId, table, column) =>
      Object.hasOwn(tableIn(namespaceId, table)?.columns ?? {}, column),
    namespacesWithTable: (table) =>
      Object.keys(contract.storage.namespaces).filter((namespaceId) =>
        hasTable(namespaceId, table),
      ),
  };
}
