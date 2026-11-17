import type { JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
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
import { MONGO_JSON_CODEC_ID } from './codec-ids';
import { mongoTargetError } from './mongo-target-errors';

const BSON_TYPE_BY_TAG: Readonly<Record<string, string>> = {
  ObjectId: 'objectId',
  Decimal128: 'decimal',
  Binary: 'binData',
  BSONRegExp: 'regex',
  Timestamp: 'timestamp',
  BSONSymbol: 'symbol',
  Code: 'javascript',
  MinKey: 'minKey',
  MaxKey: 'maxKey',
};

const NOT_FINITE_FIX =
  'JSON has no NaN or Infinity; store null or a string, or declare the field Bson.';
const BSON_FIX = 'Declare the field Bson to store BSON values.';
const PLAIN_VALUE_FIX = 'Convert it to a plain object or array.';

const ENCODE_FIX_BY_RECEIVED: Readonly<Record<string, string>> = {
  Date: 'Store the date as an ISO 8601 string, or declare the field Bson.',
  bigint:
    'Store it as a number in the safe-integer range or as decimal text, or declare the field Int64 or Bson.',
  NaN: NOT_FINITE_FIX,
  Infinity: NOT_FINITE_FIX,
  '-Infinity': NOT_FINITE_FIX,
  undefined: 'Leave the key out, or store null.',
  Uint8Array: 'Store the bytes as a base64 string, or declare the field Binary or Bson.',
  Buffer: 'Store the bytes as a base64 string, or declare the field Binary or Bson.',
  Binary: 'Store the bytes as a base64 string, or declare the field Binary or Bson.',
  ObjectId: 'Store its hex string, or declare the field ObjectId or Bson.',
  Long: 'Store a number in the safe-integer range or decimal text, or declare the field Int64 or Bson.',
  Decimal128: 'Store the decimal text, or declare the field Decimal128 or Bson.',
  Int32: 'Pass a plain number.',
  Double: 'Pass a plain number.',
  RegExp: 'Store the pattern as a string, or declare the field Bson.',
  BSONRegExp: 'Store the pattern as a string, or declare the field Bson.',
  symbol: 'Store a string instead.',
  function: 'Store data, not a function.',
  'circular reference': 'Remove the cycle; a JSON value is a tree.',
  'sparse array hole': 'Fill the hole with null.',
  DBRef: 'Write it as a { $ref, $id } document instead.',
};

function encodeFix(received: string): string {
  return (
    ENCODE_FIX_BY_RECEIVED[received] ??
    (Object.hasOwn(BSON_TYPE_BY_TAG, received) ? BSON_FIX : PLAIN_VALUE_FIX)
  );
}

function encodeRefused(received: string, path: string): never {
  throw mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `${MONGO_JSON_CODEC_ID} value must be a JSON value; received ${received} at ${where(path)}. ${encodeFix(received)}`,
    { meta: { codecId: MONGO_JSON_CODEC_ID, received, valuePath: path } },
  );
}

function describeNonJson(value: unknown): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : String(value);
  if (typeof value !== 'object') return typeof value;
  const tag = bsonTypeTag(value);
  if (tag !== undefined) return tag;
  if (value instanceof Date) return 'Date';
  if (isPlainArray(value)) return undefined;
  return isPlainObject(value) ? undefined : constructorName(value);
}

function assertJsonValue(value: unknown, path: string, ancestors: Set<object>): void {
  const received = describeNonJson(value);
  if (received !== undefined) encodeRefused(received, path);
  if (typeof value !== 'object' || value === null) return;
  if (ancestors.has(value)) encodeRefused('circular reference', path);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) encodeRefused('sparse array hole', child(path, index));
      assertJsonValue(value[index], child(path, index), ancestors);
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, child(path, key), ancestors);
    }
  }
  ancestors.delete(value);
}

/**
 * Returns `value` unchanged when it is a plain JSON value at every depth, and throws `RUNTIME.ENCODE_FAILED` naming the first value that is not, with its path.
 */
export function encodeJsonValue(value: JsonValue): JsonValue {
  assertJsonValue(value, '', new Set());
  return value;
}

function decodeRefused(bsonType: string, path: string): never {
  throw mongoTargetError(
    'RUNTIME.DECODE_FAILED',
    `${MONGO_JSON_CODEC_ID} wire value contains a non-JSON BSON ${bsonType} at ${where(path)}`,
    { meta: { codecId: MONGO_JSON_CODEC_ID, received: bsonType, valuePath: path } },
  );
}

function safeLong(value: bigint, path: string): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && BigInt(number) === value
    ? number
    : decodeRefused('long', path);
}

function finiteDouble(value: number, path: string): number {
  if (Number.isFinite(value)) return value;
  const received = String(value);
  throw mongoTargetError(
    'RUNTIME.DECODE_FAILED',
    `${MONGO_JSON_CODEC_ID} wire value contains ${received} at ${where(path)}; a JSON number cannot be NaN or Infinity`,
    { meta: { codecId: MONGO_JSON_CODEC_ID, received, valuePath: path } },
  );
}

function decodeEntries(
  entries: readonly [string, unknown][],
  path: string,
): Record<string, JsonValue> {
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, decodeValue(entry, child(path, key))]),
  );
}

function decodeTagged(value: object, tag: string, path: string): JsonValue {
  switch (tag) {
    case 'DBRef':
      return decodeEntries(dbRefEntries(value), path);
    case 'Long':
      return safeLong(
        blindCast<{ toBigInt(): bigint }, 'a BSON Long carries toBigInt'>(value).toBigInt(),
        path,
      );
    case 'Int32':
    case 'Double':
      return finiteDouble(Number(value.valueOf()), path);
  }
  return decodeRefused(BSON_TYPE_BY_TAG[tag] ?? tag, path);
}

function decodeValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finiteDouble(value, path);
  if (typeof value === 'bigint') return safeLong(value, path);
  if (typeof value === 'undefined') return decodeRefused('undefined', path);
  if (typeof value === 'symbol') return decodeRefused('symbol', path);
  if (typeof value === 'function') return decodeRefused('javascript', path);
  const tag = bsonClassTag(value);
  if (tag !== undefined) return decodeTagged(value, tag, path);
  if (value instanceof Date) return decodeRefused('date', path);
  if (value instanceof RegExp) return decodeRefused('regex', path);
  if (value instanceof Uint8Array) return decodeRefused('binData', path);
  if (Array.isArray(value)) {
    const decoded = value.map((entry, index) => decodeValue(entry, child(path, index)));
    return decoded.some((entry, index) => entry !== value[index]) ? decoded : value;
  }
  if (!isPlainObject(value)) return decodeRefused(constructorName(value), path);
  const entries = Object.entries(value);
  const decoded = decodeEntries(entries, path);
  return entries.some(([key, entry]) => decoded[key] !== entry)
    ? decoded
    : blindCast<JsonValue, 'every member decoded to itself, so the document is JSON'>(value);
}

/**
 * Decodes a wire value to the JSON value it holds: a `long` in the safe-integer range and the driver's `Int32` and `Double` wrappers become numbers. Only the objects and arrays around a converted value are copied; a wire value that is already JSON is returned as the same object. Throws `RUNTIME.DECODE_FAILED` naming the BSON type and path of the first value that is not JSON.
 */
export function decodeJsonValue(wire: unknown): JsonValue {
  return decodeValue(wire, '');
}
