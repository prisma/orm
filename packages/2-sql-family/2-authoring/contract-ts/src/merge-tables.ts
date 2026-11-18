import {
  derivedBackingIndexNode,
  type ForeignKeyAuthoringInput,
  identicalIndexes,
  indexNodeOf,
} from '@internal/sql-contract/foreign-key-materialization';
import { lowerAuthoredIndex } from '@internal/sql-contract/index-naming';
import { isArrayEqual } from '@internal/utils/array-equal';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import type { IndexNode, TableProperties, UniqueConstraintNode } from './contract-definition';
import { contractError } from './contract-errors';
import type { ColumnSite } from './declaration-sites';
import { authoredIndexInput } from './lower-table';
import {
  type ColumnDescription,
  type ModelStorage,
  type TableDescription,
  tableKey,
} from './storage-description';

type VariantStorage = Extract<ModelStorage, { kind: 'baseTable' }>;

/** A foreign key of a shared table, with the model that declares it. */
interface OwnedForeignKey {
  readonly owner: string;
  readonly declaredByBase: boolean;
  readonly foreignKey: ForeignKeyAuthoringInput;
}

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
 * A table node for a table a model maps adds its columns to that table and nothing else, because the model owns the table's table-level properties. A table node for any other table is the whole table. A single-table variant adds its indexes and foreign keys to its base's table; each of its columns must already be on that table, which the base owns, and no table node may declare a column a variant's field maps. A variant may declare only indexes with a `where` condition, since anything else would also cover the rows of other variants. A foreign key two declarations share is kept once. A variant whose table no model owns is not checked.
 *
 * Every table comes out with its foreign keys from exactly one declaration, a model or a table node, in the order that declaration lists them, followed by those its single-table variants add.
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

  const ownedForeignKeys = new Map<string, readonly OwnedForeignKey[]>();
  for (const variant of variants) {
    const key = tableKey(variant.namespaceId, variant.tableName);
    const table = tables.get(key);
    if (table === undefined) continue;
    assertVariantColumnsOnBaseTable(variant, table);
    assertVariantIndexesScoped(variant, table);
    const foreignKeys = withVariantForeignKeys(
      ownedForeignKeys.get(key) ??
        table.foreignKeys.map((foreignKey) => ({
          owner: modelOfTable.get(key) ?? table.tableName,
          declaredByBase: true,
          foreignKey,
        })),
      variant,
    );
    ownedForeignKeys.set(key, foreignKeys);
    tables.set(key, {
      ...table,
      uniques: withDistinct(table.uniques, variant.uniques),
      indexes: withDistinct(table.indexes, variant.indexes),
      foreignKeys: foreignKeys.map(({ foreignKey }) => foreignKey),
    });
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

/**
 * A variant shares its base's table, so a unique constraint or an index without a `where` condition would also cover the rows of the base and the other variants. An index the author scoped with a condition is accepted. So are two forms over exactly the columns of one of the variant's own foreign keys: the index identical to the backing index that foreign key derives, and a unique constraint, which constrains only the variant's rows because the other rows hold NULL in those columns, and which a one-to-one relation needs. Either is refused when the table already has it under another name, so that it is not stored twice.
 */
function assertVariantIndexesScoped(variant: VariantStorage, table: TableDescription): void {
  const ownForeignKeyColumns = variant.foreignKeys.map((foreignKey) => foreignKey.source.columns);
  const isBackingIndex = (index: IndexNode) => {
    if (index.columns === undefined || index.type !== undefined || index.options !== undefined) {
      return false;
    }
    const { columns } = index;
    const derived = variant.foreignKeys.some(
      (foreignKey) =>
        foreignKey.constraint &&
        foreignKey.index === true &&
        isArrayEqual(foreignKey.source.columns, columns),
    );
    return (
      derived &&
      identicalIndexes(
        indexNodeOf(lowerAuthoredIndex(variant.tableName, authoredIndexInput(index))),
        derivedBackingIndexNode(columns),
      ) &&
      !table.indexes.some(
        (other) =>
          other.where === undefined &&
          other.columns !== undefined &&
          isArrayEqual(other.columns, columns) &&
          (other.name !== index.name || other.map !== index.map),
      )
    );
  };
  const isForeignKeyUnique = (unique: UniqueConstraintNode) =>
    ownForeignKeyColumns.some((columns) => isArrayEqual(columns, unique.columns)) &&
    !table.uniques.some(
      (other) => isArrayEqual(other.columns, unique.columns) && other.name !== unique.name,
    );
  const unscoped = [
    ...variant.uniques.filter((unique) => !isForeignKeyUnique(unique)),
    ...variant.indexes.filter((index) => index.where === undefined && !isBackingIndex(index)),
  ].map((constraint) => constraint.columns ?? []);
  if (unscoped.length === 0) return;
  const listed = unscoped.map((columns) => `(${columns.join(', ')})`).join(', ');
  throw contractError(
    'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
    `Model "${variant.modelName}" shares table "${variant.tableName}" with its base model (single-table inheritance), so its unique constraints and indexes on ${listed} would also cover the rows of other variants. Without a condition, only a plain index or a unique constraint over exactly the columns of one of its own foreign keys is accepted. Declare each as an index with a \`where\` condition that selects this variant's discriminator value.`,
    {
      meta: {
        modelName: variant.modelName,
        namespaceId: variant.namespaceId,
        tableName: variant.tableName,
        unscoped,
      },
    },
  );
}

/**
 * The table's foreign keys with the variant's added. A foreign key the table already has is kept once. A different foreign key on the same columns is refused: every row would have to satisfy both.
 */
function withVariantForeignKeys(
  foreignKeys: readonly OwnedForeignKey[],
  variant: VariantStorage,
): readonly OwnedForeignKey[] {
  const merged = [...foreignKeys];
  for (const foreignKey of variant.foreignKeys) {
    const sameColumns = merged.find((existing) =>
      isArrayEqual(existing.foreignKey.source.columns, foreignKey.source.columns),
    );
    if (sameColumns === undefined) {
      merged.push({ owner: variant.modelName, declaredByBase: false, foreignKey });
      continue;
    }
    if (canonicalStringify(sameColumns.foreignKey) === canonicalStringify(foreignKey)) continue;
    const { columns } = foreignKey.source;
    const listed = columns.join(', ');
    throw contractError(
      'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
      sameColumns.declaredByBase
        ? `Model "${variant.modelName}" shares table "${variant.tableName}" with its base model "${sameColumns.owner}" (single-table inheritance) and declares a foreign key on (${listed}) that differs from the one "${sameColumns.owner}" declares there. Every row would have to satisfy both; keep only one of the two.`
        : `Models "${variant.modelName}" and "${sameColumns.owner}" share table "${variant.tableName}" (single-table inheritance) and declare different foreign keys on (${listed}). Every row would have to satisfy both; give each variant its own column.`,
      {
        meta: {
          modelName: variant.modelName,
          otherModelName: sameColumns.owner,
          namespaceId: variant.namespaceId,
          tableName: variant.tableName,
          columns,
        },
      },
    );
  }
  return merged;
}

/** `existing` followed by each of `added` that is not already there; two variants may declare the same index or unique constraint. */
function withDistinct<T>(existing: readonly T[], added: readonly T[]): readonly T[] {
  const merged = [...existing];
  for (const entry of added) {
    if (!merged.some((other) => canonicalStringify(other) === canonicalStringify(entry))) {
      merged.push(entry);
    }
  }
  return merged;
}
