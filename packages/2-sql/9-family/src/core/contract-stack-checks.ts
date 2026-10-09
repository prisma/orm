import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract } from '@internal/contract/types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import {
  isStorageTypeInstance,
  type SqlModelStorage,
  type SqlStorage,
  type StorageTable,
} from '@internal/sql-contract/types';
import { valueObjectStorageTypeMissingMessage } from '@internal/sql-contract/validators';
import { blindCast } from '@internal/utils/casts';

export interface ContractStackCheckInputs {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly authoringContributions: Pick<
    AssembledAuthoringContributions,
    'type' | 'valueObjectStorageType'
  >;
}

function tablesOf(storage: SqlStorage) {
  return Object.entries(storage.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.entries['table'] ?? {}).map(([tableName, table]) => ({
      path: `storage.namespaces.${namespaceId}.entries.table.${tableName}`,
      namespaceId,
      tableName,
      table: blindCast<StorageTable, 'entries.table of a hydrated SQL namespace'>(table),
    })),
  );
}

function dataTypeProblems(
  storage: SqlStorage,
  codecLookup: CodecLookupWithDescriptors,
): readonly string[] {
  const typed = [
    ...tablesOf(storage).flatMap(({ path, table }) =>
      Object.entries(table.columns).map(([columnName, column]) => ({
        path: `${path}.columns.${columnName}`,
        codecId: column.codecId,
        dataType: column.dataType,
      })),
    ),
    ...Object.entries(storage.types ?? {}).flatMap(([typeName, entry]) =>
      isStorageTypeInstance(entry)
        ? [{ path: `storage.types.${typeName}`, codecId: entry.codecId, dataType: entry.dataType }]
        : [],
    ),
  ];
  return typed.flatMap(({ path, codecId, dataType }) => {
    const represented = codecLookup.descriptorFor(codecId)?.dataType;
    if (represented === undefined || represented === dataType) return [];
    return [`${path}: codec ${codecId} represents ${represented}, not ${dataType}`];
  });
}

function valueObjectProblems(
  contract: Contract<SqlStorage>,
  authoring: ContractStackCheckInputs['authoringContributions'],
): readonly string[] {
  const storageTypeName = authoring.valueObjectStorageType;
  const expectedCodecId =
    storageTypeName === undefined
      ? undefined
      : collectScalarTypeConstructors(authoring.type).get(storageTypeName)?.codecId;
  const tables = new Map(
    tablesOf(contract.storage).map((entry) => [`${entry.namespaceId}\0${entry.tableName}`, entry]),
  );
  return Object.values(contract.domain.namespaces).flatMap((namespace) =>
    Object.values(namespace.models).flatMap((model) => {
      const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
      const table = tables.get(`${storage.namespaceId}\0${storage.table}`);
      if (table === undefined) return [];
      return Object.entries(model.fields).flatMap(([fieldName, field]) => {
        if (field.type.kind !== 'valueObject') return [];
        const columnName = storage.fields[fieldName]?.column;
        const column = columnName === undefined ? undefined : table.table.columns[columnName];
        if (columnName === undefined || column === undefined) return [];
        const path = `${table.path}.columns.${columnName}`;
        if (expectedCodecId === undefined) {
          return [valueObjectStorageTypeMissingMessage(path)];
        }
        if (column.codecId === expectedCodecId) return [];
        return [
          `${path}: a value-object column uses codec ${expectedCodecId}, the codec of the stack's value-object storage type ${storageTypeName}, not ${column.codecId}`,
        ];
      });
    }),
  );
}

/**
 * Checks a deserialized contract against the stack that loads it: each column's codec represents the data type the column names, and each value-object column uses the codec of the stack's value-object storage type.
 */
export function assertContractMatchesStack(
  contract: Contract<SqlStorage>,
  stack: ContractStackCheckInputs,
): void {
  const problems = [
    ...dataTypeProblems(contract.storage, stack.codecLookup),
    ...valueObjectProblems(contract, stack.authoringContributions),
  ];
  if (problems.length > 0) {
    throw new ContractValidationError(problems.join('; '), 'storage');
  }
}
