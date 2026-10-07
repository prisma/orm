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

export function bindCollectionTables(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string = resolveModelTableName(contract, namespaceId, modelName),
): CollectionTables {
  const scope = createTableScope();
  const root = bindTable(scope, { namespaceId, tableName });
  const variants = new Map<string, TableBinding>();
  for (const variant of resolvePolymorphismInfo(contract, namespaceId, modelName)?.mtiVariants ??
    []) {
    variants.set(variant.modelName, bindTable(scope, { namespaceId, tableName: variant.table }));
  }
  return { scope, root, variants };
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

export function variantColumnLabel(variantTable: TableBinding, column: string): string {
  return `${variantTable.reference}__${column}`;
}
