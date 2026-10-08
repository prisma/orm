import { contractError } from './contract-errors';
import type { ColumnDescription, ModelStorage, TableDescription } from './storage-description';

/**
 * Collects the tables the models describe, one per namespace and table name, in model order. A single-table variant's columns join its base's table, unless the base table already has a column of that name; a variant whose table no model owns adds nothing.
 */
export function mergeTables(storages: readonly ModelStorage[]): readonly TableDescription[] {
  const tables = new Map<string, TableDescription>();
  for (const storage of storages) {
    if (storage.kind !== 'ownTable') continue;
    const { table } = storage;
    const key = tableKey(table.namespaceId, table.tableName);
    if (tables.has(key)) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `buildSqlContractFromDefinition: duplicate table "${table.tableName}" in namespace "${table.namespaceId}".`,
        { meta: { kind: 'table', name: table.tableName, namespaceId: table.namespaceId } },
      );
    }
    tables.set(key, table);
  }

  for (const storage of storages) {
    if (storage.kind !== 'baseTable') continue;
    const key = tableKey(storage.namespaceId, storage.tableName);
    const table = tables.get(key);
    if (table === undefined) continue;
    tables.set(key, { ...table, columns: withAbsentColumns(table.columns, storage.columns) });
  }

  return [...tables.values()];
}

function tableKey(namespaceId: string, tableName: string): string {
  return JSON.stringify([namespaceId, tableName]);
}

function withAbsentColumns(
  columns: readonly ColumnDescription[],
  added: readonly ColumnDescription[],
): readonly ColumnDescription[] {
  const present = new Set(columns.map((column) => column.columnName));
  const absent = added.filter((column) => !present.has(column.columnName));
  return absent.length === 0 ? columns : [...columns, ...absent];
}
