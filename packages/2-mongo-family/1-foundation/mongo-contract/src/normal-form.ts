import type { NormalizeStorage } from '@internal/contract/hashing';
import { compareCodeUnits, createStorageSort } from '@internal/contract/hashing-utils';
import { isPlainRecord } from '@internal/contract/is-plain-record';

type JsonRecord = Readonly<Record<string, unknown>>;

const FALSE_BY_DEFAULT_COLLATION_FLAGS = new Set(['caseLevel', 'numericOrdering']);
const FALSE_BY_DEFAULT_INDEX_FLAGS = new Set(['unique', 'sparse']);
const SUBSCHEMA_KEYWORDS = new Set(['items', 'not', 'additionalProperties', 'additionalItems']);
const SUBSCHEMA_LIST_KEYWORDS = new Set(['oneOf', 'anyOf', 'allOf', 'items']);
const SUBSCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'dependencies']);

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

const sortIndexes = createStorageSort(
  [{ path: ['namespaces', '*', 'entries', 'collection', '*'], arrayKeys: ['indexes'] }],
  compareByNameThenContent,
);

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

function normalFieldType(fieldType: JsonRecord): JsonRecord {
  const kept = withoutEmptyTypeParams(fieldType);
  return Array.isArray(kept['members'])
    ? { ...kept, members: mapList(kept['members'], withoutEmptyTypeParams) }
    : kept;
}

function normalValueObjectField(field: JsonRecord): JsonRecord {
  const kept = withoutManyFalse(field);
  return isPlainRecord(kept['type']) ? { ...kept, type: normalFieldType(kept['type']) } : kept;
}

const normalCollation = (collation: JsonRecord): JsonRecord =>
  without(collation, (key, value) => FALSE_BY_DEFAULT_COLLATION_FLAGS.has(key) && value === false);

function normalIndex(index: JsonRecord): JsonRecord {
  const kept = without(
    index,
    (key, value) => FALSE_BY_DEFAULT_INDEX_FLAGS.has(key) && value === false,
  );
  return isPlainRecord(kept['collation'])
    ? { ...kept, collation: normalCollation(kept['collation']) }
    : kept;
}

function normalJsonSchema(schema: JsonRecord): JsonRecord {
  const kept = without(
    schema,
    (key, value) =>
      (key === 'required' && isEmptyList(value)) || (key === 'properties' && isEmptyRecord(value)),
  );
  return Object.fromEntries(
    Object.entries(kept).map(([key, value]) => {
      if (SUBSCHEMA_MAP_KEYWORDS.has(key)) return [key, mapValues(value, normalJsonSchema)];
      if (SUBSCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value))
        return [key, mapList(value, normalJsonSchema)];
      if (SUBSCHEMA_KEYWORDS.has(key) && isPlainRecord(value))
        return [key, normalJsonSchema(value)];
      return [key, value];
    }),
  );
}

function normalValidator(validator: JsonRecord): JsonRecord {
  return isPlainRecord(validator['jsonSchema'])
    ? { ...validator, jsonSchema: normalJsonSchema(validator['jsonSchema']) }
    : validator;
}

function normalOptions(options: JsonRecord): JsonRecord {
  return isPlainRecord(options['collation'])
    ? { ...options, collation: normalCollation(options['collation']) }
    : options;
}

function normalCollection(collection: JsonRecord): JsonRecord {
  const kept = without(collection, (key, value) => key === 'indexes' && isEmptyList(value));
  return {
    ...kept,
    ...(kept['indexes'] !== undefined ? { indexes: mapList(kept['indexes'], normalIndex) } : {}),
    ...(isPlainRecord(kept['validator']) ? { validator: normalValidator(kept['validator']) } : {}),
    ...(isPlainRecord(kept['options']) ? { options: normalOptions(kept['options']) } : {}),
  };
}

function normalValueObject(valueObject: JsonRecord): JsonRecord {
  return valueObject['fields'] === undefined
    ? valueObject
    : { ...valueObject, fields: mapValues(valueObject['fields'], normalValueObjectField) };
}

function normalEntries(entries: JsonRecord): JsonRecord {
  const kept = without(entries, (key, value) => key !== 'collection' && isEmptyRecord(value));
  return {
    ...kept,
    ...(kept['collection'] !== undefined
      ? { collection: mapValues(kept['collection'], normalCollection) }
      : {}),
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
 * The MongoDB family's normal form of `storage`. It leaves out the fields the family defines as equal to their absence, each named here: a collection's empty `indexes`, an index's `unique` and `sparse` of `false`, the collation flags `caseLevel` and `numericOrdering` of `false` (on an index and in a collection's options; `false` is their default for every locale), the empty `required` and `properties` of a validator's schema at any level, `many: false` on a value-object field, an empty `typeParams` on a value-object field's type, and a namespace's empty entity-kind slot other than `collection`. Every other value, including the collation flags `backwards` and `normalization` (whose default depends on the locale), partial filter expressions, clustered index, storage engine and change stream options, and the values of a value set, is kept as given. It then orders each collection's `indexes` by name, then by content.
 */
export const normalizeMongoStorage: NormalizeStorage = (storage) => {
  const plain: unknown = storage === undefined ? storage : JSON.parse(JSON.stringify(storage));
  if (!isPlainRecord(plain) || plain['namespaces'] === undefined) return plain;
  return sortIndexes({ ...plain, namespaces: mapValues(plain['namespaces'], normalNamespace) });
};

/**
 * The MongoDB family's normal form of the domain section: a model field's `many: false` is left out, as the family's readers restore it.
 */
export function normalizeMongoDomain(domain: unknown): unknown {
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
