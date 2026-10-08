import type { SchemaTables } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { sqliteIdentifiersCollide } from './identifier-case';

/**
 * The tables of a SQLite schema. SQLite has one namespace, so the namespace id is ignored, and it
 * compares table and column names without regard to the case of ASCII letters.
 */
export function sqliteSchemaTables(schema: SqlSchemaIR): SchemaTables {
  const hasTable = (_namespaceId: string, table: string) => Object.hasOwn(schema.tables, table);
  return {
    hasTable,
    hasColumn: (_namespaceId, table, column) =>
      Object.hasOwn(schema.tables[table]?.columns ?? {}, column),
    tablesNamed: (_namespaceId, table) =>
      Object.keys(schema.tables).filter((existing) => sqliteIdentifiersCollide(existing, table)),
    columnsNamed: (_namespaceId, table, column) =>
      Object.keys(schema.tables[table]?.columns ?? {}).filter((existing) =>
        sqliteIdentifiersCollide(existing, column),
      ),
    namespacesWithTable: (table) =>
      hasTable(UNBOUND_NAMESPACE_ID, table) ? [UNBOUND_NAMESPACE_ID] : [],
  };
}
