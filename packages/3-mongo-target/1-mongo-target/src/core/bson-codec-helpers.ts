import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { MinKey } from 'bson';
import {
  bsonClassTag,
  bsonTypeTag,
  child,
  constructorName,
  dbRefEntries,
  isPlainArray,
  isPlainObject,
  where,
} from './bson-walk';
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

const BSON_VERSION = Symbol.for('@@mdb.bson.version');
const BSON_MAJOR: unknown = Reflect.get(new MinKey(), BSON_VERSION);

function encodeRefused(received: string, path: string): never {
  throw mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `${MONGO_BSON_CODEC_ID} value must be a BSON value; received ${received} at ${where(path)}`,
    { meta: { codecId: MONGO_BSON_CODEC_ID, received, valuePath: path } },
  );
}

function assertBsonValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return;
  }
  if (typeof value !== 'object') {
    encodeRefused(typeof value, path);
    return;
  }
  const tag = bsonTypeTag(value);
  if (tag !== undefined) {
    if (!BSON_VALUE_TAGS.has(tag)) encodeRefused(tag, path);
    if (Reflect.get(value, BSON_VERSION) !== BSON_MAJOR) {
      encodeRefused(`${tag} not created by bson ${String(BSON_MAJOR)}`, path);
    }
    return;
  }
  if (value instanceof Date || value instanceof RegExp || value instanceof Uint8Array) return;
  if (!isPlainArray(value) && !isPlainObject(value)) {
    encodeRefused(constructorName(value), path);
    return;
  }
  if (ancestors.has(value)) encodeRefused('circular reference', path);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) encodeRefused('sparse array hole', child(path, index));
      assertBsonValue(value[index], child(path, index), ancestors);
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertBsonValue(entry, child(path, key), ancestors);
    }
  }
  ancestors.delete(value);
}

/**
 * Returns `value` unchanged when it is a BSON value at every depth, and throws `RUNTIME.ENCODE_FAILED` naming the first value that is not, with its path.
 */
export function encodeBsonValue(value: BsonInputValue): BsonInputValue {
  assertBsonValue(value, '', new Set());
  return value;
}

function decodeEntries(entries: readonly [string, unknown][]): Record<string, unknown> {
  return Object.fromEntries(entries.map(([key, entry]) => [key, decodeValue(entry)]));
}

function decodeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (bsonClassTag(value) === 'DBRef') return decodeEntries(dbRefEntries(value));
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
