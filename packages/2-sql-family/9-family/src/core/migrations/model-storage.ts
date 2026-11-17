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

/** The models of `contract` stored in `table`: a model and its single-table variants share one. */
export function modelsStoring(
  contract: ContractWithDomain,
  table: ModelTable,
): readonly ModelCoordinate[] {
  return Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) =>
      isSqlModelStorage(definition.storage) &&
      sameTable(
        { namespaceId: definition.storage.namespaceId, table: definition.storage.table },
        table,
      )
        ? [{ namespaceId: asNamespaceId(namespaceId), model }]
        : [],
    ),
  );
}

/** The fields of `contract` stored in `column` of `table`: variant fields may share one. */
export function fieldsStoring(
  contract: ContractWithDomain,
  table: ModelTable,
  column: string,
): readonly FieldCoordinate[] {
  return modelsStoring(contract, table).flatMap((model) =>
    Object.entries(sqlModelStorage(contract, model)?.fields ?? {})
      .filter(([, stored]) => stored.column === column)
      .map(([field]) => ({ ...model, field })),
  );
}

export function tableControlPolicy(contract: Contract<SqlStorage>, table: ModelTable) {
  const node = contract.storage.namespaces[table.namespaceId]?.entries.table?.[table.table];
  return governingControlPolicy(
    { explicitNodeControlPolicy: StorageTable.is(node) ? node.control : undefined },
    contract.defaultControlPolicy,
  );
}
