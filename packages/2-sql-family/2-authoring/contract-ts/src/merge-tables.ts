import type { TableProperties } from './contract-definition';
import { contractError } from './contract-errors';
import type { ColumnSite } from './declaration-sites';
import {
  type ColumnDescription,
  type ModelStorage,
  type TableDescription,
  tableKey,
} from './storage-description';

type VariantStorage = Extract<ModelStorage, { kind: 'baseTable' }>;

/** How a refusal names each table-level property. Typed by every key of {@link TableProperties}, so a new property cannot be left out of the check. */
const tablePropertyLabels: Readonly<Record<keyof TableProperties, string>> = {
  id: 'a primary key',
  uniques: 'unique constraints',
  indexes: 'indexes',
  checks: 'check constraints',
  foreignKeys: 'foreign keys',
  control: 'a control policy',
};

function isTableProperty(key: string): key is keyof TableProperties {
  return Object.hasOwn(tablePropertyLabels, key);
}

/**
 * Collects the tables the models and table nodes describe, one per namespace and table name: the models' tables in model order, then the tables only table nodes declare.
 *
 * A table node for a table a model maps adds its columns to that table and nothing else, because the model owns the table's table-level properties. A table node for any other table is the whole table. A single-table variant adds nothing: each of its columns must already be on its base's table, which the base owns, and no table node may declare a column a variant's field maps. A variant whose table no model owns is not checked.
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

  const variants = storages.filter(
    (storage): storage is VariantStorage => storage.kind === 'baseTable',
  );
  const variantColumnSites = variantColumnSitesByTable(variants);

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
    const columnSites = variantColumnSites.get(key) ?? new Map<string, ColumnSite>();
    const modelName = modelOfTable.get(key);
    const modelled = tables.get(key);
    if (modelName === undefined || modelled === undefined) {
      tables.set(key, { ...tableNode, columns: withColumns([], tableNode, columnSites) });
      continue;
    }
    assertOnlyColumns(tableNode, modelName);
    tables.set(key, {
      ...modelled,
      columns: withColumns(modelled.columns, tableNode, columnSites),
    });
  }

  for (const variant of variants) {
    const table = tables.get(tableKey(variant.namespaceId, variant.tableName));
    if (table !== undefined) assertVariantColumnsOnBaseTable(variant, table);
  }

  return [...tables.values()];
}

/** For each table, the variant field that maps each variant column; the first variant to map a column names it. */
function variantColumnSitesByTable(
  variants: readonly VariantStorage[],
): ReadonlyMap<string, ReadonlyMap<string, ColumnSite>> {
  const sites = new Map<string, Map<string, ColumnSite>>();
  for (const variant of variants) {
    const key = tableKey(variant.namespaceId, variant.tableName);
    const byColumn = sites.get(key) ?? new Map<string, ColumnSite>();
    for (const column of variant.columns) {
      if (!byColumn.has(column.columnName)) byColumn.set(column.columnName, column.site);
    }
    sites.set(key, byColumn);
  }
  return sites;
}

/**
 * The table's columns with the table node's columns added. A column some field already declares is refused, and the error names the field the author wrote: a single-table variant's field when a variant maps the column, even though the base table carries a copy of it.
 */
function withColumns(
  columns: readonly ColumnDescription[],
  tableNode: TableDescription,
  variantColumnSites: ReadonlyMap<string, ColumnSite>,
): readonly ColumnDescription[] {
  const sites = new Map(columns.map((column) => [column.columnName, column.site]));
  for (const column of tableNode.columns) {
    const earlier = variantColumnSites.get(column.columnName) ?? sites.get(column.columnName);
    if (earlier !== undefined) {
      const problem =
        earlier.kind === 'field'
          ? `is declared by field "${earlier.modelName}.${earlier.fieldName}" and again by a table node`
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
    sites.set(column.columnName, column.site);
  }
  return [...columns, ...tableNode.columns];
}

function isStated(value: TableDescription[keyof TableProperties]): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

function assertOnlyColumns(tableNode: TableDescription, modelName: string): void {
  const property = Object.keys(tablePropertyLabels)
    .filter(isTableProperty)
    .find((name) => isStated(tableNode[name]));
  if (property === undefined) return;
  throw contractError(
    'CONTRACT.TABLE_OWNED_BY_MODEL',
    `A table node for table "${tableNode.tableName}" states ${tablePropertyLabels[property]}, but model "${modelName}" maps that table and owns its table-level properties. A table node for a modelled table may only add columns.`,
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

function assertVariantColumnsOnBaseTable(variant: VariantStorage, table: TableDescription): void {
  const present = new Set(table.columns.map((column) => column.columnName));
  const missing = variant.columns.find((column) => !present.has(column.columnName));
  if (missing === undefined) return;
  throw contractError(
    'CONTRACT.VARIANT_COLUMN_NOT_ON_BASE_TABLE',
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
