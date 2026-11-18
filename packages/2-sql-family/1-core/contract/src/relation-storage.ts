import type { Contract, ContractToOneRelation } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { SqlModelStorage, SqlStorage, StorageTable } from './types';

export type SqlToOneRelationStorage = {
  /**
   * True for an N:1 relation, and for a 1:1 relation whose table declares a foreign key on
   * exactly its local columns. False for the back side of a 1:1, which declares no such key.
   */
  readonly ownsForeignKey: boolean;
  /** One entry per local field; a column that cannot be resolved counts as nullable. */
  readonly columns: readonly { readonly name: string; readonly nullable: boolean }[];
};

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

/**
 * The storage facts behind a same-space to-one relation's nullability: which side owns the
 * foreign key, and whether each local column is nullable.
 */
export function resolveSqlToOneRelationStorage(
  contract: Contract<SqlStorage>,
  modelStorage: SqlModelStorage,
  relation: ContractToOneRelation,
): SqlToOneRelationStorage {
  const table = blindCast<
    StorageTable | undefined,
    'storage table entries are validated against the storage table schema before this runs'
  >(contract.storage.namespaces[modelStorage.namespaceId]?.entries.table?.[modelStorage.table]);
  const columns = relation.on.localFields.map((fieldName) => {
    const columnName = modelStorage.fields[fieldName]?.column;
    const column = columnName === undefined ? undefined : table?.columns[columnName];
    return { name: columnName ?? fieldName, nullable: column?.nullable ?? true };
  });
  const columnNames = columns.map((column) => column.name);
  const ownsForeignKey =
    relation.cardinality === 'N:1' ||
    (table?.foreignKeys ?? []).some((foreignKey) =>
      sameColumns(foreignKey.source.columns, columnNames),
    );
  return { ownsForeignKey, columns };
}
