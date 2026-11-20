import {
  asNamespaceId,
  type Contract,
  type ContractWithDomain,
  governingControlPolicy,
  type ModelStorageBase,
} from '@internal/contract/types';
import type { FieldCoordinate, ModelCoordinate } from '@internal/framework-components/control';
import { type SqlModelStorage, type SqlStorage, StorageTable } from '@internal/sql-contract/types';

/** Where a model's rows live: a table in a storage namespace. */
export interface ModelTable {
  readonly namespaceId: string;
  readonly table: string;
}

/** Whether a model's storage names a table, as a model a SQL contract stores in a table does. */
export function isSqlModelStorage(storage: ModelStorageBase): storage is SqlModelStorage {
  return (
    typeof storage['table'] === 'string' &&
    typeof storage['namespaceId'] === 'string' &&
    typeof storage['fields'] === 'object' &&
    storage['fields'] !== null
  );
}

/** The storage of a model the contract stores in a table, or `undefined` for any other model. */
export function sqlModelStorage(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): SqlModelStorage | undefined {
  const storage =
    contract.domain.namespaces[coordinate.namespaceId]?.models[coordinate.model]?.storage;
  return storage !== undefined && isSqlModelStorage(storage) ? storage : undefined;
}

export function modelTable(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ModelTable | undefined {
  const storage = sqlModelStorage(contract, coordinate);
  return storage === undefined
    ? undefined
    : { namespaceId: storage.namespaceId, table: storage.table };
}

export function fieldColumn(
  contract: ContractWithDomain,
  coordinate: FieldCoordinate,
): string | undefined {
  const fields = sqlModelStorage(contract, coordinate)?.fields;
  return fields !== undefined && Object.hasOwn(fields, coordinate.field)
    ? fields[coordinate.field]?.column
    : undefined;
}

export function sameTable(left: ModelTable, right: ModelTable): boolean {
  return left.namespaceId === right.namespaceId && left.table === right.table;
}

/** Whether a database takes two table or column names for one. */
export type SameName = (left: string, right: string) => boolean;

export const exactName: SameName = (left, right) => left === right;

/** A model of a contract stored in a table. */
export interface StoredModel {
  readonly coordinate: ModelCoordinate;
  readonly isRoot: boolean;
  readonly fields: SqlModelStorage['fields'];
}

/**
 * The models of `contract` stored in `table`, or in a table of its namespace that `sameName` takes
 * for it: a model and its single-table variants share one.
 */
export function modelsStoring(
  contract: ContractWithDomain,
  table: ModelTable,
  sameName: SameName,
): readonly StoredModel[] {
  return Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) => {
      const { storage } = definition;
      return isSqlModelStorage(storage) &&
        storage.namespaceId === table.namespaceId &&
        sameName(storage.table, table.table)
        ? [
            {
              coordinate: { namespaceId: asNamespaceId(namespaceId), model },
              isRoot: definition.base === undefined,
              fields: storage.fields,
            },
          ]
        : [];
    }),
  );
}

/**
 * The fields of `contract` stored in `column` of `table`, or in a column `sameName` takes for it:
 * variant fields may share one.
 */
export function fieldsStoring(
  contract: ContractWithDomain,
  table: ModelTable,
  column: string,
  sameName: SameName,
): readonly FieldCoordinate[] {
  return modelsStoring(contract, table, sameName).flatMap(({ coordinate, fields }) =>
    Object.entries(fields)
      .filter(([, stored]) => sameName(stored.column, column))
      .map(([field]) => ({ ...coordinate, field })),
  );
}

export function tableControlPolicy(contract: Contract<SqlStorage>, table: ModelTable) {
  const node = contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table];
  return governingControlPolicy(
    { explicitNodeControlPolicy: StorageTable.is(node) ? node.control : undefined },
    contract.defaultControlPolicy,
  );
}
