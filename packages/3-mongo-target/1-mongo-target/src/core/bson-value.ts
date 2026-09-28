import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { MONGO_BSON_CODEC_ID } from './codec-ids';
import { mongoTargetError } from './mongo-target-errors';

const BSON_VALUE_TAGS: ReadonlySet<string> = new Set([
  'ObjectId',
  'Long',
  'Decimal128',
  'Binary',
  'BSONRegExp',
  'Timestamp',
  'Int32',
  'Double',
  'Code',
  'MinKey',
  'MaxKey',
  'BSONSymbol',
]);

function where(path: string): string {
  return path === '' ? 'the root' : path;
}

function child(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function encodeRefused(received: string, path: string): never {
  throw mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `${MONGO_BSON_CODEC_ID} value must be a BSON value; received ${received} at ${where(path)}`,
    { meta: { codecId: MONGO_BSON_CODEC_ID, received, path } },
  );
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function constructorName(value: object): string {
  const name = Reflect.get(value, 'constructor')?.name;
  return typeof name === 'string' && name !== '' ? name : 'object';
}

function assertBsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) encodeRefused(String(value), path);
    return;
  }
  if (typeof value !== 'object') {
    encodeRefused(typeof value, path);
    return;
  }
  const tag = Reflect.get(value, '_bsontype');
  if (typeof tag === 'string') {
    if (!BSON_VALUE_TAGS.has(tag)) encodeRefused(tag, path);
    return;
  }
  if (value instanceof Date || value instanceof RegExp || value instanceof Uint8Array) return;
  if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
    for (let index = 0; index < value.length; index++) {
      const at = child(path, String(index));
      if (!(index in value)) encodeRefused('sparse array hole', at);
      assertBsonValue(value[index], at);
    }
    return;
  }
  if (!isPlainObject(value)) {
    encodeRefused(constructorName(value), path);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertBsonValue(entry, child(path, key));
  }
}

/**
 * Returns `value` unchanged when it is a BSON value at every depth, and throws `RUNTIME.ENCODE_FAILED` naming the first value that is not, with its path.
 */
export function encodeBsonValue(value: BsonInputValue): BsonInputValue {
  assertBsonValue(value, '');
  return value;
}

interface DbRefShape {
  readonly collection: unknown;
  readonly oid: unknown;
  readonly db?: unknown;
  readonly fields: Record<string, unknown>;
}

function isDbRef(value: object): boolean {
  return Reflect.get(value, '_bsontype') === 'DBRef';
}

function decodeEntries(entries: readonly [string, unknown][]): Record<string, unknown> {
  return Object.fromEntries(entries.map(([key, entry]) => [key, decodeValue(entry)]));
}

function decodeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (isDbRef(value)) {
    const ref = blindCast<DbRefShape, 'a bson DBRef carries collection, oid, db and fields'>(value);
    const entries: [string, unknown][] = [
      ['$ref', ref.collection],
      ['$id', ref.oid],
    ];
    if (ref.db !== undefined) entries.push(['$db', ref.db]);
    entries.push(...Object.entries(ref.fields));
    return decodeEntries(entries);
  }
  if (Array.isArray(value)) {
    const decoded = value.map(decodeValue);
    return decoded.some((entry, index) => entry !== value[index]) ? decoded : value;
  }
  if (!isPlainObject(value)) return value;
  const entries = Object.entries(value);
  const decoded = decodeEntries(entries);
  return entries.some(([key, entry]) => decoded[key] !== entry) ? decoded : value;
}

/**
 * Returns the wire value as the driver produced it, except that a `DBRef` the `bson` library read from a `{ $ref, $id }` subdocument becomes that document again, `{ $ref, $id[, $db], ...fields }`, with its members' BSON types kept. A value holding no `DBRef` is returned as the same object.
 */
export function decodeBsonValue(wire: unknown): BsonValue {
  return blindCast<
    BsonValue,
    'the driver reads only BSON values, and a rebuilt DBRef is a document of them'
  >(decodeValue(wire));
}
