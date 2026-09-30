import type { JsonValue } from '@internal/contract/types';
import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import { Binary, Code, type Document, Double, EJSON } from 'bson';
import {
  BSON_MAJOR,
  bsonClassTag,
  bsonTypeTag,
  child,
  constructorName,
  createdByBsonMajor,
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

const ENCODE_FIX_BY_RECEIVED: Readonly<Record<string, string>> = {
  DBRef: 'Write it as a { $ref, $id } document instead.',
};

function encodeRefused(received: string, path: string): never {
  const fix = ENCODE_FIX_BY_RECEIVED[received];
  throw mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `${MONGO_BSON_CODEC_ID} value must be a BSON value; received ${received} at ${where(path)}${fix === undefined ? '' : `. ${fix}`}`,
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
    if (!createdByBsonMajor(value)) {
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

interface CodeWithScope {
  readonly code: string;
  readonly scope: Document;
}

/**
 * A `Code` value with a scope, recognised by its tag: the driver reads with its own load of `bson`, so its `Code` is not an instance of the class imported here.
 */
function codeWithScope(value: object): CodeWithScope | undefined {
  if (bsonClassTag(value) !== 'Code') return undefined;
  const code = Reflect.get(value, 'code');
  const scope = Reflect.get(value, 'scope');
  return typeof code === 'string' && typeof scope === 'object' && scope !== null
    ? { code, scope }
    : undefined;
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
  const code = codeWithScope(value);
  if (code !== undefined) {
    const scope = decodeValue(code.scope);
    return scope === code.scope
      ? value
      : new Code(code.code, blindCast<Document, 'a decoded document is a document'>(scope));
  }
  if (!isPlainObject(value)) return value;
  const entries = Object.entries(value);
  const decoded = decodeEntries(entries);
  return entries.some(([key, entry]) => decoded[key] !== entry) ? decoded : value;
}

/**
 * Returns the wire value as the driver produced it, except that a `DBRef` the `bson` library read from a `{ $ref, $id }` subdocument becomes that document again, `{ $ref, $id[, $db], ...fields }`, with its members' BSON types kept, at any depth and inside a `Code` scope. A value holding no `DBRef` is returned as the same object.
 */
export function decodeBsonValue(wire: unknown): BsonValue {
  return blindCast<
    BsonValue,
    'the driver reads only BSON values, and a rebuilt DBRef is a document of them'
  >(decodeValue(wire));
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

function asDriverWrites(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) && (value < INT32_MIN || value > INT32_MAX)
      ? new Double(value)
      : value;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof Uint8Array) return new Binary(value);
  if (Array.isArray(value)) return value.map(asDriverWrites);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, asDriverWrites(entry)]),
    );
  }
  const code = codeWithScope(value);
  if (code !== undefined) {
    return new Code(
      code.code,
      blindCast<Document, 'a Code scope is a document'>(asDriverWrites(code.scope)),
    );
  }
  return value;
}

/**
 * Canonical Extended JSON for a BSON value, recording each JavaScript number and `Uint8Array` as the BSON type the driver writes for it: an integer outside the int32 range as a `double`, and bytes as `binData`.
 */
export function encodeBsonJson(value: BsonInputValue): JsonValue {
  return blindCast<JsonValue, 'canonical Extended JSON is plain JSON'>(
    EJSON.serialize(asDriverWrites(value), { relaxed: false }),
  );
}

export function decodeBsonJson(json: JsonValue): BsonInputValue {
  return EJSON.deserialize(blindCast<Document, 'canonical Extended JSON is a document'>(json), {
    relaxed: false,
  });
}
