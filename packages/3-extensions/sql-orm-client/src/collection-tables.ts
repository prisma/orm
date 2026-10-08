import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { resolveModelTableName, resolvePolymorphismInfo } from './collection-contract';
import {
  bindTable,
  copyTableScope,
  createTableScope,
  type TableBinding,
  type TableScope,
  type TableStorageCoordinate,
} from './table-scope';

export interface CollectionTables {
  readonly scope: TableScope;
  readonly root: TableBinding;
  readonly variants: ReadonlyMap<string, TableBinding>;
}

function bindModelTables(
  contract: Contract<SqlStorage>,
  scope: TableScope,
  namespaceId: string,
  modelName: string,
  tableName: string,
): CollectionTables {
  const root = bindTable(scope, { namespaceId, tableName });
  const variants = new Map<string, TableBinding>();
  for (const variant of resolvePolymorphismInfo(contract, namespaceId, modelName)?.mtiVariants ??
    []) {
    variants.set(variant.modelName, bindTable(scope, { namespaceId, tableName: variant.table }));
  }
  return { scope, root, variants };
}

export function bindCollectionTables(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string = resolveModelTableName(contract, namespaceId, modelName),
): CollectionTables {
  return bindModelTables(contract, createTableScope(), namespaceId, modelName, tableName);
}

export interface IncludeTables {
  readonly tables: CollectionTables;
  readonly junction: TableBinding | undefined;
}

export function bindIncludeTables(
  contract: Contract<SqlStorage>,
  parent: CollectionTables,
  relation: {
    readonly relatedNamespaceId: string;
    readonly relatedModelName: string;
    readonly relatedTableName: string;
    readonly through?: { readonly namespaceId: string; readonly table: string } | undefined;
  },
): IncludeTables {
  const scope = copyTableScope(parent.scope);
  const tables = bindModelTables(
    contract,
    scope,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    relation.relatedTableName,
  );
  const junction =
    relation.through === undefined
      ? undefined
      : bindTable(scope, {
          namespaceId: relation.through.namespaceId,
          tableName: relation.through.table,
        });
  return { tables, junction };
}

export function bindStatementTable(storage: TableStorageCoordinate): CollectionTables {
  const scope = createTableScope();
  return { scope, root: bindTable(scope, storage), variants: new Map() };
}

export function withScopeCopy(tables: CollectionTables): CollectionTables {
  return { ...tables, scope: copyTableScope(tables.scope) };
}

export function requireVariantBinding(
  tables: CollectionTables,
  variantModelName: string,
): TableBinding {
  const binding = tables.variants.get(variantModelName);
  if (binding === undefined) {
    throw new InternalError(
      `Collection state has no table binding for variant "${variantModelName}"`,
    );
  }
  return binding;
}

export function tableReferences(
  tables: CollectionTables,
): ReadonlyMap<string, TableStorageCoordinate> {
  return new Map(
    [tables.root, ...tables.variants.values()].map((binding) => [
      binding.reference,
      binding.storage,
    ]),
  );
}

export function variantColumnLabelPrefix(variantTable: TableBinding): string {
  return `${variantTable.reference}__`;
}

export function variantColumnLabel(variantTable: TableBinding, column: string): string {
  return `${variantColumnLabelPrefix(variantTable)}${column}`;
}
