import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type { TableProperties } from './contract-definition';
import { contractError } from './contract-errors';
import type { ColumnSite } from './declaration-sites';
import { inNamespace } from './namespace-id';
import {
  columnsPhrase,
  mergeSharedTable,
  type SharedForeignKeyView,
  type SharedTableRefusal,
  type VariantTableSharer,
} from './shared-table-constraints';
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
 * A table node for a table a model maps adds its columns to that table and nothing else, because the model owns the table's table-level properties. A table node for any other table is the whole table. A single-table variant adds its indexes and foreign keys to its base's table, by the rules of {@link mergeSharedTable}, which refuse its uniques; each of its columns must already be on that table, which the base owns, and no table node may declare a column a variant's field maps. A variant whose table no model owns adds nothing, and its columns are checked only when a table node declares that table.
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
        `buildSqlContractFromDefinition: duplicate table "${table.tableName}"${inNamespace(table.namespaceId)}.`,
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
        `Table "${tableNode.tableName}"${inNamespace(tableNode.namespaceId)} is declared by two table nodes.`,
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

  const variantsByTable = new Map<string, VariantStorage[]>();
  for (const variant of variants) {
    const key = tableKey(variant.namespaceId, variant.tableName);
    const table = tables.get(key);
    if (table === undefined) continue;
    assertVariantColumnsOnBaseTable(variant, table);
    variantsByTable.set(key, [...(variantsByTable.get(key) ?? []), variant]);
  }
  for (const [key, sharing] of variantsByTable) {
    const table = tables.get(key);
    const baseModel = modelOfTable.get(key);
    if (table === undefined || baseModel === undefined) continue;
    tables.set(key, withVariantConstraints(table, baseModel, sharing));
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
 * The base model's table with what its single-table variants declare added, or the first refusal of what they declare.
 *
 * A definition has to put every variant column on the base table, so a base column a variant maps is taken to be that variant's: the base model is counted as mapping only the columns no variant maps.
 */
function withVariantConstraints(
  table: TableDescription,
  baseModel: string,
  variants: readonly VariantStorage[],
): TableDescription {
  const variantColumns = new Set(
    variants.flatMap((variant) => variant.columns.map((column) => column.columnName)),
  );
  const merged = mergeSharedTable({
    tableName: table.tableName,
    base: {
      modelName: baseModel,
      columns: new Set(
        table.columns
          .map((column) => column.columnName)
          .filter((columnName) => !variantColumns.has(columnName)),
      ),
      defaultedColumns: new Set(
        table.columns
          .filter((column) => column.default !== undefined)
          .map((column) => column.columnName)
          .filter((columnName) => !variantColumns.has(columnName)),
      ),
      foreignKeys: table.foreignKeys,
      indexes: table.indexes,
    },
    variants: variants.map(
      (variant): VariantTableSharer<ForeignKeyAuthoringInput> => ({
        modelName: variant.modelName,
        columns: new Set(variant.columns.map((column) => column.columnName)),
        defaultedColumns: new Set(
          [...variant.columns, ...table.columns]
            .filter((column) => column.default !== undefined)
            .map((column) => column.columnName)
            .filter((columnName) => variant.columns.some((own) => own.columnName === columnName)),
        ),
        foreignKeys: variant.foreignKeys,
        uniques: variant.uniques,
        indexes: variant.indexes,
      }),
    ),
    viewOf: foreignKeyView,
  });
  const [refusal] = merged.refusals;
  if (refusal !== undefined) throw refusalError(table, merged.refusals, refusal);
  return {
    ...table,
    indexes: merged.indexes,
    foreignKeys: merged.foreignKeys,
  };
}

function foreignKeyView(foreignKey: ForeignKeyAuthoringInput): SharedForeignKeyView {
  const { source, target, constraint, index, ...rest } = foreignKey;
  const { columns: _sourceColumns, ...sourceTable } = source;
  const { columns: targetColumns, ...targetTable } = target;
  return {
    columns: source.columns,
    targetColumns,
    rest: { ...rest, sourceTable, targetTable, constraint, index },
    constraint,
    derivesIndex: index === true,
    namedIndex: typeof index === 'string' ? index : undefined,
  };
}

function refusalError(
  table: TableDescription,
  refusals: readonly SharedTableRefusal<ForeignKeyAuthoringInput>[],
  first: SharedTableRefusal<ForeignKeyAuthoringInput>,
) {
  const { namespaceId, tableName } = table;
  if (first.kind === 'defaultedForeignKey') {
    return contractError(
      'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
      `Model "${first.variant}" declares a foreign key on (${first.foreignKey.source.columns.join(', ')}) of table "${tableName}", but ${columnsPhrase(first.columns)} has a default, which the rows of every model sharing the table get too (single-table inheritance). Remove the default.`,
      {
        meta: {
          modelName: first.variant,
          namespaceId,
          tableName,
          columns: first.columns,
        },
      },
    );
  }
  if (first.kind === 'foreignKey') {
    const listed = first.columns.join(', ');
    const message = first.otherDeclaresOne
      ? first.otherIsBase
        ? `Model "${first.variant}" shares table "${tableName}" with its base model "${first.other}" (single-table inheritance) and declares a foreign key on (${listed}) that differs from the one "${first.other}" declares there. Every row would have to satisfy both; keep only one of the two.`
        : `Models "${first.variant}" and "${first.other}" share table "${tableName}" (single-table inheritance) and declare different foreign keys on (${listed}). Every row would have to satisfy both; give each variant its own column.`
      : first.otherIsBase
        ? `Model "${first.variant}" declares a foreign key on (${first.foreignKey.source.columns.join(', ')}) of table "${tableName}", but its base model "${first.other}" also maps ${columnsPhrase(first.columns)} without it (single-table inheritance). Every row of the table would have to satisfy it; give "${first.variant}" a column of its own.`
        : `Model "${first.variant}" declares a foreign key on (${first.foreignKey.source.columns.join(', ')}) of table "${tableName}", but model "${first.other}" also maps ${columnsPhrase(first.columns)} without it (single-table inheritance). Every "${first.other}" row would have to satisfy it; give "${first.variant}" a column of its own.`;
    return contractError('CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT', message, {
      meta: {
        modelName: first.variant,
        otherModelName: first.other,
        namespaceId,
        tableName,
        columns: first.columns,
      },
    });
  }
  const unscoped = refusals
    .filter(
      (refusal) =>
        (refusal.kind === 'unique' || refusal.kind === 'index') &&
        refusal.variant === first.variant,
    )
    .map((refusal) =>
      refusal.kind === 'unique'
        ? refusal.unique.columns
        : refusal.kind === 'index'
          ? (refusal.index.columns ?? [])
          : [],
    );
  const listed = unscoped.map((columns) => `(${columns.join(', ')})`).join(', ');
  return contractError(
    'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
    `Model "${first.variant}" shares table "${tableName}" with its base model (single-table inheritance), so its unique constraints and indexes on ${listed} would also cover the rows of other variants. Without a condition, only the backing index of one of its own foreign keys is accepted. Declare each as an index with a \`where\` condition that selects this variant's discriminator value.`,
    { meta: { modelName: first.variant, namespaceId, tableName, unscoped } },
  );
}
