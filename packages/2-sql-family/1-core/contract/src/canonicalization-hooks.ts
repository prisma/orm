import type { NormalizeStorage } from '@internal/contract/hashing';
import { createStorageSort, type NamedArraySortTarget } from '@internal/contract/hashing-utils';
import { isPlainRecord } from '@internal/contract/is-plain-record';

type JsonRecord = Readonly<Record<string, unknown>>;

const sortTargets = [
  {
    path: ['namespaces', '*', 'entries', 'table', '*'],
    arrayKeys: ['checks', 'indexes', 'uniques'],
  },
] as const satisfies readonly NamedArraySortTarget[];

const sortStorage = createStorageSort(sortTargets);

const isEmptyRecord = (value: unknown): boolean =>
  isPlainRecord(value) && Object.keys(value).length === 0;

const isEmptyList = (value: unknown): boolean => Array.isArray(value) && value.length === 0;

function without(
  record: JsonRecord,
  leaveOut: (key: string, value: unknown) => boolean,
): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => !leaveOut(key, value)));
}

function mapValues(value: unknown, map: (entry: JsonRecord) => JsonRecord): unknown {
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, isPlainRecord(entry) ? map(entry) : entry]),
  );
}

function mapList(value: unknown, map: (entry: JsonRecord) => JsonRecord): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry: unknown) => (isPlainRecord(entry) ? map(entry) : entry));
}

const withoutSingleValueMany = (field: JsonRecord): JsonRecord =>
  without(field, (key, value) => key === 'many' && value === false);

function normalIndex(index: JsonRecord): JsonRecord {
  return without(
    index,
    (key, value) =>
      (key === 'columns' && isEmptyList(value)) || (key === 'options' && isEmptyRecord(value)),
  );
}

function normalForeignKey(foreignKey: JsonRecord): JsonRecord {
  return without(
    foreignKey,
    (key, value) =>
      (key === 'index' && value === false) ||
      ((key === 'onDelete' || key === 'onUpdate') && value === 'noAction'),
  );
}

function normalTable(table: JsonRecord): JsonRecord {
  const kept = without(table, (key, value) => key === 'checks' && isEmptyList(value));
  return {
    ...kept,
    ...(kept['columns'] !== undefined
      ? { columns: mapValues(kept['columns'], withoutSingleValueMany) }
      : {}),
    ...(kept['indexes'] !== undefined ? { indexes: mapList(kept['indexes'], normalIndex) } : {}),
    ...(kept['foreignKeys'] !== undefined
      ? { foreignKeys: mapList(kept['foreignKeys'], normalForeignKey) }
      : {}),
  };
}

function normalValueObject(valueObject: JsonRecord): JsonRecord {
  return valueObject['fields'] === undefined
    ? valueObject
    : { ...valueObject, fields: mapValues(valueObject['fields'], withoutSingleValueMany) };
}

function normalEntries(entries: JsonRecord): JsonRecord {
  const kept = without(entries, (key, value) => key !== 'table' && isEmptyRecord(value));
  return {
    ...kept,
    ...(kept['table'] !== undefined ? { table: mapValues(kept['table'], normalTable) } : {}),
    ...(kept['valueObject'] !== undefined
      ? { valueObject: mapValues(kept['valueObject'], normalValueObject) }
      : {}),
  };
}

function normalNamespace(namespace: JsonRecord): JsonRecord {
  return isPlainRecord(namespace['entries'])
    ? { ...namespace, entries: normalEntries(namespace['entries']) }
    : namespace;
}

function normalStorageType(storageType: JsonRecord): JsonRecord {
  return without(storageType, (key, value) => key === 'typeParams' && isEmptyRecord(value));
}

/**
 * The SQL family's normal form of `storage`. It leaves out the fields the family defines as equal to their absence, each named here: `many: false` on a column or a value-object field, an empty `checks` list, an index's empty `columns` and empty `options`, a foreign key's `index: false` and its `onDelete`/`onUpdate` of `noAction`, a storage type's empty `typeParams`, and a namespace's empty entity-kind slot other than `table`. Every other value, including the contents of type parameters, index options and every entry a pack contributes, is kept as given. It then orders each table's `checks`, `indexes` and `uniques` by name.
 */
const normalizeStorage: NormalizeStorage = (storage) => {
  const plain: unknown = storage === undefined ? storage : JSON.parse(JSON.stringify(storage));
  if (!isPlainRecord(plain)) return sortStorage(plain);
  return sortStorage({
    ...plain,
    ...(plain['namespaces'] !== undefined
      ? { namespaces: mapValues(plain['namespaces'], normalNamespace) }
      : {}),
    ...(plain['types'] !== undefined
      ? { types: mapValues(plain['types'], normalStorageType) }
      : {}),
  });
};

/**
 * The SQL family's normal form of the domain section: a model field's `many: false` is left out, as the family's readers restore it.
 */
export function normalSqlDomain(domain: unknown): unknown {
  if (!isPlainRecord(domain)) return domain;
  return {
    ...domain,
    namespaces: mapValues(domain['namespaces'], (namespace) =>
      namespace['models'] === undefined
        ? namespace
        : {
            ...namespace,
            models: mapValues(namespace['models'], (model) =>
              model['fields'] === undefined
                ? model
                : { ...model, fields: mapValues(model['fields'], withoutSingleValueMany) },
            ),
          },
    ),
  };
}

export const sqlContractCanonicalizationHooks: {
  readonly normalizeStorage: NormalizeStorage;
} = {
  normalizeStorage,
};
