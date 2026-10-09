import { contractError } from './contract-errors';
import {
  type ColumnDescription,
  type ModelStorage,
  type TableDescription,
  tableKey,
} from './storage-description';

/**
 * Collects the tables the models and table nodes describe, one per namespace and table name: the models' tables in model order, then the tables only table nodes declare.
 *
 * A table node for a table a model maps adds its columns to that table and nothing else, because the model owns the table's table-level properties. A table node for any other table is the whole table. A single-table variant adds nothing: each of its columns must already be on its base's table, which the base owns. A variant whose table no model owns is not checked.
 *
 * Every table comes out with its foreign keys from exactly one declaration, a model or a table node, in the order that declaration lists them.
 */
export function mergeTables(
  storages: readonly ModelStorage[],
  tableNodes: readonly TableDescription[],
): readonly TableDescription[] {
  const tables = new Map<string, TableDescription>();
  const modelOfTable = new Map<string, string>();
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
    modelOfTable.set(key, storage.modelName);
  }

  const tableNodeKeys = new Set<string>();
  for (const tableNode of tableNodes) {
    const key = tableKey(tableNode.namespaceId, tableNode.tableName);
    if (tableNodeKeys.has(key)) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Table "${tableNode.tableName}" in namespace "${tableNode.namespaceId}" is declared by two table nodes.`,
        { meta: { kind: 'table', name: tableNode.tableName, namespaceId: tableNode.namespaceId } },
      );
    }
    tableNodeKeys.add(key);
    const modelName = modelOfTable.get(key);
    const modelled = tables.get(key);
    if (modelName === undefined || modelled === undefined) {
      tables.set(key, { ...tableNode, columns: withColumns([], tableNode) });
      continue;
    }
    assertOnlyColumns(tableNode, modelName);
    tables.set(key, { ...modelled, columns: withColumns(modelled.columns, tableNode) });
  }

  for (const storage of storages) {
    if (storage.kind !== 'baseTable') continue;
    const table = tables.get(tableKey(storage.namespaceId, storage.tableName));
    if (table !== undefined) assertVariantColumnsOnBaseTable(storage, table);
  }

  return [...tables.values()];
}

function withColumns(
  columns: readonly ColumnDescription[],
  tableNode: TableDescription,
): readonly ColumnDescription[] {
  const byName = new Map(columns.map((column) => [column.columnName, column]));
  for (const column of tableNode.columns) {
    const earlier = byName.get(column.columnName);
    if (earlier !== undefined) {
      const problem =
        earlier.site.kind === 'field'
          ? `is declared by field "${earlier.site.modelName}.${earlier.site.fieldName}" and again by a table node`
          : 'is listed twice by its table node';
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Column "${column.columnName}" of table "${tableNode.tableName}" ${problem}.`,
        {
          meta: {
            kind: 'column',
            name: column.columnName,
            tableName: tableNode.tableName,
            namespaceId: tableNode.namespaceId,
          },
        },
      );
    }
    byName.set(column.columnName, column);
  }
  return [...columns, ...tableNode.columns];
}

function tableLevelPropertiesOf(table: TableDescription): readonly string[] {
  return [
    ...(table.primaryKey !== undefined ? ['id'] : []),
    ...(table.uniques.length > 0 ? ['uniques'] : []),
    ...(table.indexes.length > 0 ? ['indexes'] : []),
    ...(table.checks.length > 0 ? ['checks'] : []),
    ...(table.foreignKeys.length > 0 ? ['foreignKeys'] : []),
    ...(table.control !== undefined ? ['control'] : []),
  ];
}

function assertOnlyColumns(tableNode: TableDescription, modelName: string): void {
  const [property] = tableLevelPropertiesOf(tableNode);
  if (property === undefined) return;
  throw contractError(
    'CONTRACT.TABLE_OWNED_BY_MODEL',
    `A table node for table "${tableNode.tableName}" states ${property}, but model "${modelName}" maps that table and owns its table-level properties. A table node for a modelled table may only add columns.`,
    {
      meta: {
        namespaceId: tableNode.namespaceId,
        tableName: tableNode.tableName,
        modelName,
        property,
      },
    },
  );
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
