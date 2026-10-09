import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { resolveModelTableName, resolvePolymorphismInfo } from './collection-contract';
import {
  type AliasedTable,
  createTableScope,
  type TableScope,
  type TableStorageCoordinate,
} from './table-scope';

export interface CollectionTables {
  readonly scope: TableScope;
  readonly root: AliasedTable;
  readonly variants: ReadonlyMap<string, AliasedTable>;
}

function createModelTables(
  contract: Contract<SqlStorage>,
  scope: TableScope,
  namespaceId: string,
  modelName: string,
  tableName: string,
): CollectionTables {
  const root = scope.aliasTable({ namespaceId, tableName });
  const variants = new Map<string, AliasedTable>();
  for (const variant of resolvePolymorphismInfo(contract, namespaceId, modelName)?.mtiVariants ??
    []) {
    variants.set(variant.modelName, scope.aliasTable({ namespaceId, tableName: variant.table }));
  }
  return { scope, root, variants };
}

export function createCollectionTables(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string = resolveModelTableName(contract, namespaceId, modelName),
): CollectionTables {
  return createModelTables(contract, createTableScope(), namespaceId, modelName, tableName);
}

export interface IncludeTables {
  readonly tables: CollectionTables;
  readonly junction: AliasedTable | undefined;
}

export function createIncludeTables(
  contract: Contract<SqlStorage>,
  parent: CollectionTables,
  relation: {
    readonly relatedNamespaceId: string;
    readonly relatedModelName: string;
    readonly relatedTableName: string;
    readonly through?: { readonly namespaceId: string; readonly table: string } | undefined;
  },
): IncludeTables {
  const scope = parent.scope.copy();
  const tables = createModelTables(
    contract,
    scope,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    relation.relatedTableName,
  );
  const junction =
    relation.through === undefined
      ? undefined
      : scope.aliasTable({
          namespaceId: relation.through.namespaceId,
          tableName: relation.through.table,
        });
  return { tables, junction };
}

export function createStatementTables(storage: TableStorageCoordinate): CollectionTables {
  const scope = createTableScope();
  return { scope, root: scope.aliasTable(storage), variants: new Map() };
}

export function withScopeCopy(tables: CollectionTables): CollectionTables {
  return { ...tables, scope: tables.scope.copy() };
}

export function requireVariantTable(
  tables: CollectionTables,
  variantModelName: string,
): AliasedTable {
  const variantTable = tables.variants.get(variantModelName);
  if (variantTable === undefined) {
    throw new InternalError(
      `Collection state has no aliased table for variant "${variantModelName}"`,
    );
  }
  return variantTable;
}

export function tableAliases(
  tables: CollectionTables,
): ReadonlyMap<string, TableStorageCoordinate> {
  return new Map(
    [tables.root, ...tables.variants.values()].map((table) => [table.alias, table.storage]),
  );
}

export function variantColumnLabelPrefix(variantTable: AliasedTable): string {
  return `${variantTable.alias}__`;
}

export function variantColumnLabel(variantTable: AliasedTable, column: string): string {
  return `${variantColumnLabelPrefix(variantTable)}${column}`;
}
