import { blindCast } from '@internal/utils/casts';

export function where(path: string): string {
  return path === '' ? 'the root' : path;
}

export function child(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

export function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isPlainArray(value: object): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

export function bsonTypeTag(value: object): string | undefined {
  const tag = Reflect.get(value, '_bsontype');
  return typeof tag === 'string' ? tag : undefined;
}

/**
 * The `_bsontype` tag of a `bson` class instance. A stored subdocument is read as a plain object even when it has a `_bsontype` key, so a plain object has no tag.
 */
export function bsonClassTag(value: object): string | undefined {
  return isPlainObject(value) ? undefined : bsonTypeTag(value);
}

export function constructorName(value: object): string {
  const name = Reflect.get(value, 'constructor')?.name;
  return typeof name === 'string' && name !== '' ? name : 'object';
}

interface DbRefShape {
  readonly collection: unknown;
  readonly oid: unknown;
  readonly db?: unknown;
  readonly fields: Record<string, unknown>;
}

/**
 * The `bson` library reads any subdocument with a string `$ref` and an `$id` as a `DBRef`. It was stored as a plain object; these are its entries in stored order, `$ref`, `$id`, `$db` when present, then the other fields.
 */
export function dbRefEntries(value: object): [string, unknown][] {
  const ref = blindCast<DbRefShape, 'a bson DBRef carries collection, oid, db and fields'>(value);
  const entries: [string, unknown][] = [
    ['$ref', ref.collection],
    ['$id', ref.oid],
  ];
  if (ref.db !== undefined) entries.push(['$db', ref.db]);
  entries.push(...Object.entries(ref.fields));
  return entries;
}
