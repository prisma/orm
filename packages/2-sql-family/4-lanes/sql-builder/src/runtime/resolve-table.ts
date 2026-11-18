import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';

export function resolveTableInNamespace(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const namespace = storage.namespaces[namespaceId];
  if (namespace === undefined) return undefined;
  const tables = namespace.entries.table;
  if (tables === undefined || !Object.hasOwn(tables, tableName)) return undefined;
  return tables[tableName];
}
