import {
  defaultMongoDomainNamespaceId,
  type MongoContract,
  mongoModelsOf,
} from '@internal/mongo-contract';
import { MongoParamRef, type MongoValue } from '@internal/mongo-value';

/** The codec of a model's scalar field, and whether the field is a list. */
export interface FieldCodec {
  readonly codecId: string;
  readonly many: boolean;
}

/** A model's scalar fields by stored name, and the collection that holds them. */
export interface FieldCodecs {
  readonly collection: string;
  readonly fields: ReadonlyMap<string, FieldCodec>;
}

/** The scalar fields of `modelName` by stored name, so a match value can be encoded through the field's codec. */
export function modelFieldCodecs(
  contract: MongoContract,
  modelName: string,
  collection: string,
): FieldCodecs | undefined {
  const model = mongoModelsOf(contract.domain, defaultMongoDomainNamespaceId)[modelName];
  if (model === undefined) return undefined;
  const fields = new Map<string, FieldCodec>();
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.type.kind !== 'scalar') continue;
    const storedName = model.storage.fields?.[name]?.field ?? name;
    fields.set(storedName, { codecId: field.type.codecId, many: Boolean(field.many) });
  }
  return { collection, fields };
}

function paramOf(value: MongoValue, codecId: string, path: string, collection: string): MongoValue {
  return value === null || value instanceof MongoParamRef
    ? value
    : new MongoParamRef(value, { codecId, name: path, collection });
}

/** A value of the field at `path`, encoded through the field's codec as the ORM encodes one: a list field's array element by element. A path that names no scalar field of the model keeps its value as it is. */
export function encodedFieldValue(
  codecs: FieldCodecs | undefined,
  path: string,
  value: MongoValue,
): MongoValue {
  const field = codecs?.fields.get(path);
  if (codecs === undefined || field === undefined) return value;
  if (field.many && Array.isArray(value)) {
    return value.map((element: MongoValue) =>
      paramOf(element, field.codecId, path, codecs.collection),
    );
  }
  return paramOf(value, field.codecId, path, codecs.collection);
}

/** Each value of a list for the field at `path`, such as an `$in` list, encoded as one value of the field, or one element of a list field. */
export function encodedFieldValues(
  codecs: FieldCodecs | undefined,
  path: string,
  values: ReadonlyArray<MongoValue>,
): ReadonlyArray<MongoValue> {
  const field = codecs?.fields.get(path);
  if (codecs === undefined || field === undefined) return values;
  return values.map((value) => paramOf(value, field.codecId, path, codecs.collection));
}

function isPlainDocument(value: MongoValue): value is Readonly<Record<string, MongoValue>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** One element of the list field at `path`, as `$push`, `$addToSet` and `$pull` take it: encoded through the field's codec. A `{ $each: [...] }` modifier has each element encoded; another document, such as a `$pull` condition, keeps its value as it is. */
export function encodedElementValue(
  codecs: FieldCodecs | undefined,
  path: string,
  value: MongoValue,
): MongoValue {
  const field = codecs?.fields.get(path);
  if (codecs === undefined || field === undefined) return value;
  if (isPlainDocument(value)) {
    const each = value['$each'];
    return Array.isArray(each)
      ? { ...value, $each: encodedFieldValues(codecs, path, each) }
      : value;
  }
  return paramOf(value, field.codecId, path, codecs.collection);
}

/** A document to insert, each of its model fields encoded through the field's codec. */
export function encodedDocument(
  codecs: FieldCodecs | undefined,
  document: Readonly<Record<string, MongoValue>>,
): Record<string, MongoValue> {
  return Object.fromEntries(
    Object.entries(document).map(([path, value]) => [path, encodedFieldValue(codecs, path, value)]),
  );
}
