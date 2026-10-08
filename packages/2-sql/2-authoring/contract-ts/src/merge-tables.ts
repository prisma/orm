import { contractError } from './contract-errors';
import type { ModelStorage, TableDescription } from './storage-description';

/**
 * Collects the tables the models describe, one per namespace and table name, in model order. A single-table variant adds nothing: each of its columns must already be on its base's table, which the base owns. A variant whose table no model owns is not checked.
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
    const table = tables.get(tableKey(storage.namespaceId, storage.tableName));
    if (table !== undefined) assertVariantColumnsOnBaseTable(storage, table);
  }

  return [...tables.values()];
}

function tableKey(namespaceId: string, tableName: string): string {
  return JSON.stringify([namespaceId, tableName]);
}

function assertVariantColumnsOnBaseTable(
  variant: Extract<ModelStorage, { kind: 'baseTable' }>,
  table: TableDescription,
): void {
  const present = new Set(table.columns.map((column) => column.columnName));
  const missing = variant.columns.find((column) => !present.has(column.columnName));
  if (missing === undefined) return;
  throw contractError(
    'CONTRACT.COLUMN_ON_STI_VARIANT',
    `Model "${variant.modelName}" shares table "${variant.tableName}" with its base model (single-table inheritance), but its column "${missing.columnName}" is not on that table. The base model owns the table; declare the column there.`,
    {
      meta: {
        modelName: variant.modelName,
        namespaceId: variant.namespaceId,
        tableName: variant.tableName,
        columnName: missing.columnName,
      },
    },
  );
}
