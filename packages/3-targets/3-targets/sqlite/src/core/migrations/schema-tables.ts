import type { SchemaTables } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/** The tables of a SQLite schema. SQLite has one namespace, so the namespace id is ignored. */
export function sqliteSchemaTables(schema: SqlSchemaIR): SchemaTables {
  const hasTable = (_namespaceId: string, table: string) => Object.hasOwn(schema.tables, table);
  return {
    hasTable,
    hasColumn: (_namespaceId, table, column) =>
      Object.hasOwn(schema.tables[table]?.columns ?? {}, column),
    namespacesWithTable: (table) =>
      hasTable(UNBOUND_NAMESPACE_ID, table) ? [UNBOUND_NAMESPACE_ID] : [],
  };
}
