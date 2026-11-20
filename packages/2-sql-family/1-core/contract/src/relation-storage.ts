import type { Contract, ContractToOneRelation } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { SqlModelStorage, SqlStorage, StorageTable } from './types';

export type SqlToOneRelationStorage = {
  /**
   * True for an N:1 relation, and for a 1:1 relation whose table declares a foreign key on
   * exactly its local columns pointing at the relation's target table. False for the back
   * side of a 1:1, which declares no such key.
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
 *
 * Ownership is matched on the full foreign-key coordinate — source columns, target table,
 * and target columns — never on source columns alone. Matching columns alone misattributes
 * ownership whenever a table carries an unrelated foreign key on the same columns, e.g. a
 * shared-PK 1:1 chain (class-table inheritance) where every table's primary key is also a
 * foreign key to its parent: the back-relation's local columns coincide with the table's
 * own upward foreign key and would be misclassified as owning it.
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
  const targetStorage = blindCast<
    SqlModelStorage | undefined,
    'domain model storage is validated against the SQL model storage schema before this runs'
  >(contract.domain.namespaces[relation.to.namespace]?.models[relation.to.model]?.storage);
  const targetTable = targetStorage?.table;
  const targetColumns = relation.on.targetFields.map(
    (fieldName) => targetStorage?.fields[fieldName]?.column ?? fieldName,
  );
  const ownsForeignKey =
    relation.cardinality === 'N:1' ||
    (table?.foreignKeys ?? []).some(
      (foreignKey) =>
        sameColumns(foreignKey.source.columns, columnNames) &&
        foreignKey.target.namespaceId === targetStorage?.namespaceId &&
        foreignKey.target.tableName === targetTable &&
        sameColumns(foreignKey.target.columns, targetColumns),
    );
  return { ownsForeignKey, columns };
}
