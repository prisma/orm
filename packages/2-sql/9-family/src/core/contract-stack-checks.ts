import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { Contract } from '@internal/contract/types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import {
  type CodecLookupWithDescriptors,
  type DataType,
  type DataTypeLookup,
  type DataTypeParams,
  dataTypeParams,
} from '@internal/framework-components/codec';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { isSqlDataType, validateSqlTypeParams } from '@internal/sql-contract/data-type';
import {
  isStorageTypeInstance,
  resolvedTypeParams,
  type SqlModelStorage,
  type SqlStorage,
  type StorageTable,
} from '@internal/sql-contract/types';
import { valueObjectStorageTypeMissingMessage } from '@internal/sql-contract/validators';
import { blindCast } from '@internal/utils/casts';
import { isInternalError } from '@internal/utils/internal-error';
import { isStructuredError } from '@internal/utils/structured-error';

export interface ContractStackCheckInputs {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: { readonly lookup: DataTypeLookup };
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

/** Whether `type` refuses `params`. The check of the column's parameters reports that, so its default is not read under them. */
function refusesParams(type: DataType, params: DataTypeParams): boolean {
  if (!isSqlDataType(type)) return false;
  try {
    validateSqlTypeParams(type, params);
    return false;
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.TYPE_PARAMS_INVALID') return true;
    throw error;
  }
}

/** A literal default its column's type does not hold, with where it is. */
interface RefusedDefault {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly dataType: string;
  readonly value: unknown;
  /** The refused element's position in a list default, counted from 0; absent for a single value. */
  readonly elementIndex?: number;
  /** The data type's own message, or why a default on a list column is not a list. */
  readonly message: string;
  readonly reason: 'type-refused-default';
}

/** A refused default, with the sentence the load refusal prints for it. */
interface Refusal {
  readonly refused: RefusedDefault;
  readonly text: string;
}

/** Names the namespace, unless the contract has only the unbound one, as a SQLite contract does. */
function columnPlace(refused: Pick<RefusedDefault, 'namespaceId' | 'table' | 'column'>): string {
  return refused.namespaceId === UNBOUND_NAMESPACE_ID
    ? `Table "${refused.table}", column "${refused.column}"`
    : `Namespace "${refused.namespaceId}", table "${refused.table}", column "${refused.column}"`;
}

function notAValue(refused: RefusedDefault): Refusal {
  return {
    refused,
    text: `${columnPlace(refused)}: the default ${JSON.stringify(refused.value)}${refused.elementIndex === undefined ? '' : ` at element ${refused.elementIndex + 1}`} is not a value of ${refused.dataType}: ${refused.message}`,
  };
}

function notAList(refused: RefusedDefault): Refusal {
  return {
    refused,
    text: `${columnPlace(refused)}: the default ${JSON.stringify(refused.value)} is not a list, and the column holds a list of ${refused.dataType}`,
  };
}

/** Each literal default the column's type does not hold, under the column's parameters, element by element on a list column. A `null` is SQL NULL, which every column takes. */
function refusedDefaults(storage: SqlStorage, dataTypes: DataTypeLookup): readonly Refusal[] {
  return tablesOf(storage).flatMap(({ namespaceId, tableName, table }) =>
    Object.entries(table.columns).flatMap(([columnName, column]) => {
      const columnDefault = column.default;
      if (columnDefault?.kind !== 'literal') return [];
      const type = dataTypes.get(column.dataType);
      if (type === undefined) return [];
      const params = dataTypeParams(type, resolvedTypeParams(column, storage.types));
      if (refusesParams(type, params)) return [];
      const place = { namespaceId, table: tableName, column: columnName, dataType: type.id };
      const isList = column.many !== undefined && column.many !== false;
      if (isList && columnDefault.value !== null && !Array.isArray(columnDefault.value)) {
        return [
          notAList({
            ...place,
            value: columnDefault.value,
            message: 'The column holds a list, and the default is not one.',
            reason: 'type-refused-default',
          }),
        ];
      }
      const listed = isList && Array.isArray(columnDefault.value);
      const values =
        isList && Array.isArray(columnDefault.value) ? columnDefault.value : [columnDefault.value];
      for (const [index, value] of values.entries()) {
        if (value === null) continue;
        try {
          type.fromContract(value, params);
        } catch (error) {
          if (isInternalError(error)) throw error;
          return [
            notAValue({
              ...place,
              value,
              ...(listed ? { elementIndex: index } : {}),
              message: error instanceof Error ? error.message : String(error),
              reason: 'type-refused-default',
            }),
          ];
        }
      }
      return [];
    }),
  );
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
 * Checks a deserialized contract against the stack that loads it: each column's codec represents the data type the column names, each value-object column uses the codec of the stack's value-object storage type, and each literal default is a value of its column's type under the column's parameters.
 */
export function assertContractMatchesStack(
  contract: Contract<SqlStorage>,
  stack: ContractStackCheckInputs,
): void {
  const defaults = refusedDefaults(contract.storage, stack.dataTypes.lookup);
  const problems = [
    ...dataTypeProblems(contract.storage, stack.codecLookup),
    ...valueObjectProblems(contract, stack.authoringContributions),
    ...defaults.map(({ text }) => text),
  ];
  if (problems.length > 0) {
    throw new ContractValidationError(
      problems.join('; '),
      'storage',
      defaults.length > 0 ? { refusedDefaults: defaults.map(({ refused }) => refused) } : undefined,
    );
  }
}
