import type { JsonValue } from '@internal/contract/types';
import { Binary, Decimal128, Double, Long, ObjectId } from 'bson';
import { mongoTargetError } from './mongo-target-errors';

const DECIMAL_INTEGER = /^-?\d+$/;
const CANONICAL_DECIMAL_TEXT = /^(?:-?\d+(?:\.\d+)?|NaN|-?Infinity)$/;
const DECIMAL128_TEXT = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/;
const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Checks the BSON type tag rather than `instanceof`: the driver deserialises with its own load of `bson` (CommonJS, where this module may be loaded as ESM), so a value read from the database need not be an instance of the class imported here.
 */
function hasBsonTypeTag(
  value: unknown,
  tag: 'Long' | 'Decimal128' | 'Binary' | 'ObjectId',
): boolean {
  return (
    typeof value === 'object' && value !== null && '_bsontype' in value && value._bsontype === tag
  );
}

function isLong(value: unknown): value is Long {
  return hasBsonTypeTag(value, 'Long');
}

function isDecimal128(value: unknown): value is Decimal128 {
  return hasBsonTypeTag(value, 'Decimal128');
}

function isBinary(value: unknown): value is Binary {
  return hasBsonTypeTag(value, 'Binary');
}

function decodeFailed(codecId: string, message: string, received: unknown): never {
  throw mongoTargetError('RUNTIME.DECODE_FAILED', `${codecId} ${message}`, {
    meta: { codecId, received: typeof received },
  });
}

const RECEIVED_PREVIEW_LIMIT = 100;

function encodeFailed(codecId: string, message: string, received: unknown): never {
  throw mongoTargetError('RUNTIME.ENCODE_FAILED', `${codecId} ${message}`, {
    meta: { codecId, received: String(received).slice(0, RECEIVED_PREVIEW_LIMIT) },
  });
}

function describeReceived(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string') {
    return `string ${JSON.stringify(value.slice(0, RECEIVED_PREVIEW_LIMIT))}`;
  }
  if (value === null) return 'null';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'an invalid Date' : 'a Date';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function refuseType(
  codecId: string,
  expected: string,
  value: unknown,
  received = describeReceived(value),
): never {
  return encodeFailed(codecId, `value must be ${expected}; received ${received}`, value);
}

export function stringEncode(codecId: string, value: string): string {
  if (typeof value !== 'string') refuseType(codecId, 'a string', value);
  return value;
}

export function booleanEncode(codecId: string, value: boolean): boolean {
  if (typeof value !== 'boolean') refuseType(codecId, 'a boolean', value);
  return value;
}

/**
 * The driver writes an invalid `Date` as the epoch, so one is refused with any other non-`Date` value.
 */
export function dateEncode(codecId: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    refuseType(codecId, 'a valid Date', value);
  }
  return value;
}

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

function hexStringOf(value: object): string | undefined {
  const toHexString: unknown = Reflect.get(value, 'toHexString');
  if (typeof toHexString !== 'function') return undefined;
  const hex: unknown = Reflect.apply(toHexString, value, []);
  return typeof hex === 'string' && OBJECT_ID_HEX.test(hex) ? hex : undefined;
}

/**
 * `new ObjectId(...)` makes a fresh id from `null` or `undefined` and reads a number as a timestamp, so only a string, which the constructor accepts only as 24 hex digits, or an `ObjectId` is passed to it. An `ObjectId` is rebuilt from its hex string, so one from any major version of `bson` works.
 */
export function objectIdEncode(codecId: string, value: string): ObjectId {
  const expected = 'a 24-digit hex string or an ObjectId';
  if (typeof value === 'string') {
    try {
      return new ObjectId(value);
    } catch {
      return refuseType(codecId, expected, value);
    }
  }
  if (typeof value !== 'object' || value === null || !hasBsonTypeTag(value, 'ObjectId')) {
    return refuseType(codecId, expected, value);
  }
  const hex = hexStringOf(value);
  if (hex === undefined) {
    return refuseType(
      codecId,
      expected,
      value,
      'an object tagged ObjectId whose toHexString() does not return 24 hex digits',
    );
  }
  return new ObjectId(hex);
}

export function vectorEncode(codecId: string, value: readonly number[]): readonly number[] {
  if (!Array.isArray(value) || !value.every((element) => typeof element === 'number')) {
    refuseType(codecId, 'an array of numbers', value);
  }
  return value;
}

/**
 * Wraps the number in the driver's `Double`, because the driver writes a whole JavaScript number in the int32 range as a BSON `int`, which a `double` validator refuses.
 */
export function doubleEncode(codecId: string, value: number): Double {
  if (typeof value !== 'number') {
    encodeFailed(codecId, `value must be a number; received ${describeReceived(value)}`, value);
  }
  return new Double(value);
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

export function int32Encode(codecId: string, value: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < INT32_MIN ||
    value > INT32_MAX
  ) {
    encodeFailed(
      codecId,
      `value must be an integer from ${INT32_MIN} to ${INT32_MAX}; received ${describeReceived(value)}`,
      value,
    );
  }
  return value;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * `Long.fromBigInt` keeps the low 64 bits of any bigint, so an out-of-range value would be stored as a different number without error.
 */
function isInt64(value: bigint): boolean {
  return value >= INT64_MIN && value <= INT64_MAX;
}

function requireInt64(codecId: string, value: bigint): bigint {
  if (!isInt64(value)) encodeFailed(codecId, 'value is outside the signed 64-bit range', value);
  return value;
}

export function int64Encode(codecId: string, value: bigint): Long {
  if (typeof value !== 'bigint') encodeFailed(codecId, 'value must be a bigint', value);
  return Long.fromBigInt(requireInt64(codecId, value));
}

/**
 * A stored double with a fraction, which a 64-bit integer codec cannot read. Such values were written through a Prisma 6 `Int` while its contract used the 32-bit codec, which took any number.
 */
function refuseFractionalDouble(codecId: string, wire: number): never {
  return decodeFailed(
    codecId,
    `wire value is the fractional double ${wire}, and a 64-bit integer holds whole numbers only. Rewrite each such stored value as a long, rounded or cut off ({ $toLong: { $round: [<value>, 0] } }, or $trunc in place of $round), mapping over the list when the value sits in one. The upgrade guide step prisma6-int-written-as-long has the queries for a plain field, a list and a list of composite values.`,
    wire,
  );
}

/**
 * The driver promotes a stored `long` that fits in 53 bits to a `number`, and hands larger ones over as `Long`, so both arrive here.
 */
export function int64Decode(codecId: string, wire: Long | number | bigint): bigint {
  if (typeof wire === 'bigint') return wire;
  if (isLong(wire)) return wire.toBigInt();
  if (typeof wire === 'number' && Number.isSafeInteger(wire)) return BigInt(wire);
  if (typeof wire === 'number' && Number.isFinite(wire) && !Number.isInteger(wire)) {
    return refuseFractionalDouble(codecId, wire);
  }
  return decodeFailed(codecId, 'wire value must be a Long or a safe integer', wire);
}

/**
 * A schema-written default arrives as a `number`; one that is a safe integer names its value exactly, so it is accepted like `pg/int8@1` accepts it.
 */
export function int64EncodeJson(codecId: string, value: bigint | number): string {
  if (typeof value === 'bigint') return requireInt64(codecId, value).toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value).toString();
  return encodeFailed(codecId, 'value must be a bigint or a safe integer', value);
}

export function int64DecodeJson(codecId: string, json: JsonValue): bigint {
  if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
    return decodeFailed(codecId, 'JSON value must be decimal integer text', json);
  }
  const value = BigInt(json);
  if (!isInt64(value)) {
    return decodeFailed(codecId, 'JSON value is outside the signed 64-bit range', json);
  }
  return value;
}

const SAFE_INTEGER_RANGE = `from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}`;

export function int64NumberEncode(codecId: string, value: number): Long {
  if (!Number.isSafeInteger(value)) {
    encodeFailed(
      codecId,
      `value must be an integer ${SAFE_INTEGER_RANGE}; received ${describeReceived(value)}`,
      value,
    );
  }
  return Long.fromNumber(value);
}

function safeIntegerOf(codecId: string, subject: string, value: bigint): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    decodeFailed(
      codecId,
      `${subject} must be a whole number ${SAFE_INTEGER_RANGE}; received ${value}`,
      value,
    );
  }
  return Number(value);
}

/**
 * The driver hands a stored `long` over as a `number` when it fits in 53 bits (the default `promoteLongs`), as a `Long` otherwise or with `promoteLongs: false`, and as a `bigint` with `useBigInt64`.
 */
export function int64NumberDecode(codecId: string, wire: Long | number | bigint): number {
  if (typeof wire === 'bigint') return safeIntegerOf(codecId, 'wire value', wire);
  if (isLong(wire)) return safeIntegerOf(codecId, 'wire value', wire.toBigInt());
  if (typeof wire === 'number' && Number.isSafeInteger(wire)) return wire;
  if (typeof wire === 'number' && Number.isFinite(wire) && !Number.isInteger(wire)) {
    return refuseFractionalDouble(codecId, wire);
  }
  return decodeFailed(
    codecId,
    `wire value must be a whole number ${SAFE_INTEGER_RANGE}; received ${describeReceived(wire)}`,
    wire,
  );
}

export function int64NumberEncodeJson(codecId: string, value: number): string {
  return int64NumberEncode(codecId, value).toString();
}

export function int64NumberDecodeJson(codecId: string, json: JsonValue): number {
  if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
    return decodeFailed(codecId, 'JSON value must be decimal integer text', json);
  }
  return safeIntegerOf(codecId, 'JSON value', BigInt(json));
}

export function decimalTextNumberLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' && DECIMAL_INTEGER.test(value) ? value : undefined;
}

export function decimalTextBigintLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' && DECIMAL_INTEGER.test(value) ? `${value}n` : undefined;
}

/**
 * `Decimal128.toString()` writes some values with an exponent (`1E+3`, `1.23E+40`). The application value is decimal text without one, as for Postgres `numeric`: the point moves to where the exponent puts it, trailing zeros stay, and the sign of zero goes.
 */
export function canonicalDecimalText(text: string): string | undefined {
  if (text === 'NaN' || text === 'Infinity' || text === '-Infinity') return text;
  const match = DECIMAL128_TEXT.exec(text);
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  let integerPart: string;
  let fractionPart: string;
  if (point <= 0) {
    integerPart = '0';
    fractionPart = `${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    integerPart = `${digits}${'0'.repeat(point - digits.length)}`;
    fractionPart = '';
  } else {
    integerPart = digits.slice(0, point);
    fractionPart = digits.slice(point);
  }
  const trimmedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const unsigned = fractionPart === '' ? trimmedInteger : `${trimmedInteger}.${fractionPart}`;
  return /^[0.]+$/.test(unsigned) ? unsigned : `${sign}${unsigned}`;
}

function requireCanonicalDecimalText(codecId: string, value: string): string {
  if (typeof value !== 'string' || !CANONICAL_DECIMAL_TEXT.test(value)) {
    encodeFailed(
      codecId,
      'value must be decimal text without an exponent, or NaN, Infinity or -Infinity',
      value,
    );
  }
  return value;
}

export function decimal128Encode(codecId: string, value: string): Decimal128 {
  requireCanonicalDecimalText(codecId, value);
  try {
    return Decimal128.fromString(value);
  } catch (error) {
    return encodeFailed(
      codecId,
      `value cannot be stored as a Decimal128 exactly: ${error instanceof Error ? error.message : String(error)}`,
      value,
    );
  }
}

export function decimal128Decode(codecId: string, wire: Decimal128): string {
  if (!isDecimal128(wire)) {
    return decodeFailed(codecId, 'wire value must be a Decimal128', wire);
  }
  const text = canonicalDecimalText(wire.toString());
  if (text === undefined) return decodeFailed(codecId, 'wire value is not decimal text', wire);
  return text;
}

export function decimal128EncodeJson(codecId: string, value: string): string {
  return requireCanonicalDecimalText(codecId, value);
}

/**
 * The JSON form is what `encodeJson` writes, so it follows the encode rule: canonical decimal text (no exponent), or `NaN`, `Infinity` or `-Infinity`, that a Decimal128 holds exactly.
 */
export function decimal128DecodeJson(codecId: string, json: JsonValue): string {
  if (typeof json !== 'string' || !CANONICAL_DECIMAL_TEXT.test(json)) {
    return decodeFailed(
      codecId,
      'JSON value must be decimal text without an exponent, or NaN, Infinity or -Infinity',
      json,
    );
  }
  try {
    Decimal128.fromString(json);
  } catch {
    return decodeFailed(codecId, 'JSON value cannot be stored as a Decimal128 exactly', json);
  }
  return json;
}

export function binaryEncode(codecId: string, value: Uint8Array): Binary {
  if (!(value instanceof Uint8Array)) encodeFailed(codecId, 'value must be a Uint8Array', value);
  return new Binary(value);
}

/**
 * The driver reads binData as a `Binary`, or as a `Buffer` with `promoteBuffers: true`; either becomes a plain `Uint8Array` copy of the bytes.
 */
export function binaryDecode(codecId: string, wire: Binary | Uint8Array): Uint8Array {
  if (wire instanceof Uint8Array) return new Uint8Array(wire);
  if (!isBinary(wire)) {
    return decodeFailed(codecId, 'wire value must be a Binary or a Uint8Array', wire);
  }
  return new Uint8Array(wire.value());
}

export function binaryEncodeJson(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

export function binaryDecodeJson(codecId: string, json: JsonValue): Uint8Array {
  if (typeof json !== 'string' || !BASE64_TEXT.test(json)) {
    return decodeFailed(codecId, 'JSON value must be base64 text', json);
  }
  return new Uint8Array(Buffer.from(json, 'base64'));
}
