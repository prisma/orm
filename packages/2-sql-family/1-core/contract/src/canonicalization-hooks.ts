import type { NormalizeStorage } from '@internal/contract/hashing';
import {
  compareCodeUnits,
  createStorageSort,
  type NamedArraySortTarget,
} from '@internal/contract/hashing-utils';
import { isPlainRecord } from '@internal/contract/is-plain-record';

type JsonRecord = Readonly<Record<string, unknown>>;

const sortTargets = [
  {
    path: ['namespaces', '*', 'entries', 'table', '*'],
    arrayKeys: ['checks', 'foreignKeys', 'indexes', 'uniques'],
  },
] as const satisfies readonly NamedArraySortTarget[];

const nameOf = (entry: unknown): string =>
  isPlainRecord(entry) && typeof entry['name'] === 'string' ? entry['name'] : '';

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => [key, withSortedKeys(value[key])]),
  );
}

const contentOf = (entry: unknown): string => JSON.stringify(withSortedKeys(entry));

const compareByNameThenContent = (a: unknown, b: unknown): number =>
  compareCodeUnits(nameOf(a), nameOf(b)) || compareCodeUnits(contentOf(a), contentOf(b));

const sortStorage = createStorageSort(sortTargets, compareByNameThenContent);

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

const withoutManyFalse = (field: JsonRecord): JsonRecord =>
  without(field, (key, value) => key === 'many' && value === false);

const withoutEmptyTypeParams = (record: JsonRecord): JsonRecord =>
  without(record, (key, value) => key === 'typeParams' && isEmptyRecord(value));

const normalColumn = (column: JsonRecord): JsonRecord =>
  withoutEmptyTypeParams(withoutManyFalse(column));

function normalValueObjectField(field: JsonRecord): JsonRecord {
  const kept = withoutManyFalse(field);
  return isPlainRecord(kept['type'])
    ? { ...kept, type: withoutEmptyTypeParams(kept['type']) }
    : kept;
}

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
      (key === 'index' && typeof value === 'boolean') ||
      ((key === 'onDelete' || key === 'onUpdate') && value === 'noAction'),
  );
}

function normalTable(table: JsonRecord): JsonRecord {
  const kept = without(table, (key, value) => key === 'checks' && isEmptyList(value));
  return {
    ...kept,
    ...(kept['columns'] !== undefined ? { columns: mapValues(kept['columns'], normalColumn) } : {}),
    ...(kept['indexes'] !== undefined ? { indexes: mapList(kept['indexes'], normalIndex) } : {}),
    ...(kept['foreignKeys'] !== undefined
      ? { foreignKeys: mapList(kept['foreignKeys'], normalForeignKey) }
      : {}),
  };
}

function normalValueObject(valueObject: JsonRecord): JsonRecord {
  return valueObject['fields'] === undefined
    ? valueObject
    : { ...valueObject, fields: mapValues(valueObject['fields'], normalValueObjectField) };
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

/**
 * The SQL family's normal form of `storage`. It leaves out the fields the family defines as equal to their absence, each named here: `many: false` on a column or a value-object field, an empty `typeParams` on a column, a value-object field's type or a storage type, an empty `checks` list, an index's empty `columns` and empty `options`, a foreign key's `true` or `false` `index` (the flag of contracts emitted before 0.16, which reads as absent) and its `onDelete`/`onUpdate` of `noAction`, and a namespace's empty entity-kind slot other than `table`. Every other value, including the contents of type parameters, index options and every entry a pack contributes, is kept as given. It then orders each table's `checks`, `foreignKeys`, `indexes` and `uniques` by name, and entries with no name, or the same name, by their content.
 */
export const normalizeSqlStorage: NormalizeStorage = (storage) => {
  const plain: unknown = storage === undefined ? storage : JSON.parse(JSON.stringify(storage));
  if (!isPlainRecord(plain)) return sortStorage(plain);
  return sortStorage({
    ...plain,
    ...(plain['namespaces'] !== undefined
      ? { namespaces: mapValues(plain['namespaces'], normalNamespace) }
      : {}),
    ...(plain['types'] !== undefined
      ? { types: mapValues(plain['types'], withoutEmptyTypeParams) }
      : {}),
  });
};

/**
 * The SQL family's normal form of the domain section: a model field's `many: false` is left out, as the family's readers restore it.
 */
export function normalizeSqlDomain(domain: unknown): unknown {
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
                : { ...model, fields: mapValues(model['fields'], withoutManyFalse) },
            ),
          },
    ),
  };
}
