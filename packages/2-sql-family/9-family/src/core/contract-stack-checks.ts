import { ContractValidationError } from '@internal/contract/contract-validation-error';
import {
  type Contract,
  type JsonValue,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import {
  assertDataTypeParams,
  type CodecLookupWithDescriptors,
  type DataTypeLookup,
  dataTypeParams,
  validateCodecTypeParams,
} from '@internal/framework-components/codec';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  isStorageTypeInstance,
  nonEmptyTypeParams,
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

/** A place in a contract that names a codec and may give it type parameters, with its path. */
interface ParameterizedPlace {
  readonly path: string;
  readonly codecId: string;
  readonly typeParams: unknown;
}

function scalarTypesOf(path: string, type: unknown): readonly ParameterizedPlace[] {
  if (type === null || typeof type !== 'object') return [];
  const kind: unknown = Reflect.get(type, 'kind');
  if (kind === 'union') {
    const members: unknown = Reflect.get(type, 'members');
    return Array.isArray(members)
      ? members.flatMap((member, index) => scalarTypesOf(`${path}.members[${index}]`, member))
      : [];
  }
  const codecId: unknown = Reflect.get(type, 'codecId');
  if (kind !== 'scalar' || typeof codecId !== 'string') return [];
  return [{ path, codecId, typeParams: Reflect.get(type, 'typeParams') }];
}

function fieldTypesOf(
  path: string,
  fields: Readonly<Record<string, { readonly type: unknown }>>,
): readonly ParameterizedPlace[] {
  return Object.entries(fields).flatMap(([fieldName, field]) =>
    scalarTypesOf(`${path}.fields.${fieldName}.type`, field.type),
  );
}

function parameterizedPlaces(contract: Contract<SqlStorage>): readonly ParameterizedPlace[] {
  const storage = contract.storage;
  return [
    ...tablesOf(storage).flatMap(({ path, table }) =>
      Object.entries(table.columns).map(([columnName, column]) => ({
        path: `${path}.columns.${columnName}`,
        codecId: column.codecId,
        typeParams: column.typeParams,
      })),
    ),
    ...Object.entries(storage.types ?? {}).flatMap(([typeName, entry]) =>
      isStorageTypeInstance(entry)
        ? [
            {
              path: `storage.types.${typeName}`,
              codecId: entry.codecId,
              typeParams: entry.typeParams,
            },
          ]
        : [],
    ),
    ...Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
      Object.entries(namespace.models).flatMap(([modelName, model]) =>
        fieldTypesOf(`domain.namespaces.${namespaceId}.models.${modelName}`, model.fields),
      ),
    ),
    ...valueObjectsWithCoordinates(storage).flatMap(({ coordinate, valueObject }) =>
      fieldTypesOf(
        `storage.namespaces.${coordinate.namespaceId}.entries.valueObject.${coordinate.entityName}`,
        valueObject.fields,
      ),
    ),
  ];
}

/** Each place whose type parameters its codec's parameter schema refuses, as the runtime refuses them when it builds the codec. A codec without a parameter schema takes no parameters. A codec the stack does not register is not checked here. */
function typeParamsProblems(
  contract: Contract<SqlStorage>,
  codecLookup: CodecLookupWithDescriptors,
): readonly string[] {
  return parameterizedPlaces(contract).flatMap(({ path, codecId, typeParams }) => {
    if (typeParams === undefined) return [];
    const descriptor = codecLookup.descriptorFor(codecId);
    if (descriptor === undefined) return [];
    try {
      validateCodecTypeParams(descriptor, {
        codecId,
        typeParams: blindCast<JsonValue, 'stored type parameters are JSON read from the contract'>(
          typeParams,
        ),
      });
      return [];
    } catch (error) {
      if (isStructuredError(error) && error.code === 'RUNTIME.TYPE_PARAMS_INVALID') {
        return [`${path}.typeParams: ${error.message}`];
      }
      throw error;
    }
  });
}

/** Refuses, with the data type's own `CONTRACT.TYPE_PARAMS_INVALID`, the first column or storage type that gives type parameters its data type refuses, as planning and the client refuse them. */
function assertDataTypesAcceptParams(storage: SqlStorage, dataTypes: DataTypeLookup): void {
  const places = [
    ...tablesOf(storage).flatMap(({ table }) => Object.values(table.columns)),
    ...Object.values(storage.types ?? {}).filter(isStorageTypeInstance),
  ];
  for (const { dataType, typeParams } of places) {
    const given = nonEmptyTypeParams(typeParams);
    const type = dataTypes.get(dataType);
    if (given === undefined || type === undefined) continue;
    assertDataTypeParams(type, dataTypeParams(type, given));
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

/** Each literal default the column's type does not hold, under the column's parameters, which its data type accepts, element by element on a list column. A `null` is SQL NULL, which every column takes. */
function refusedDefaults(storage: SqlStorage, dataTypes: DataTypeLookup): readonly Refusal[] {
  return tablesOf(storage).flatMap(({ namespaceId, tableName, table }) =>
    Object.entries(table.columns).flatMap(([columnName, column]) => {
      const columnDefault = column.default;
      if (columnDefault?.kind !== 'literal') return [];
      const type = dataTypes.get(column.dataType);
      if (type === undefined) return [];
      const params = dataTypeParams(type, nonEmptyTypeParams(column.typeParams));
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
 * Checks a deserialized contract against the stack that loads it: the data type of each column and storage type accepts the type parameters given it, which it refuses with its own error before any other problem is reported, each column's codec represents the data type the column names, the codec's parameter schema accepts each type parameter a column, storage type, model field or value-object field gives it, each value-object column uses the codec of the stack's value-object storage type, and each literal default is a value of its column's type under the column's parameters.
 */
export function assertContractMatchesStack(
  contract: Contract<SqlStorage>,
  stack: ContractStackCheckInputs,
): void {
  assertDataTypesAcceptParams(contract.storage, stack.dataTypes.lookup);
  const defaults = refusedDefaults(contract.storage, stack.dataTypes.lookup);
  const problems = [
    ...dataTypeProblems(contract.storage, stack.codecLookup),
    ...typeParamsProblems(contract, stack.codecLookup),
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
