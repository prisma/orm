import type { JsonValue } from '@internal/contract/types';
import { mongoCodec } from '@internal/mongo-codec';
import { Long } from 'bson';
import { MONGO_INT64_NUMBER_CODEC_ID } from './codec-ids';
import { mongoTargetError } from './mongo-target-errors';

const DECIMAL_INTEGER = /^-?\d+$/;
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const RECEIVED_PREVIEW_LIMIT = 100;

function encodeFailed(codecId: string, message: string, received: unknown): never {
  throw mongoTargetError('RUNTIME.ENCODE_FAILED', `${codecId} ${message}`, {
    meta: { codecId, received: String(received).slice(0, RECEIVED_PREVIEW_LIMIT) },
  });
}

function decodeFailed(codecId: string, message: string, received: unknown): never {
  throw mongoTargetError('RUNTIME.DECODE_FAILED', `${codecId} ${message}`, {
    meta: { codecId, received: String(received).slice(0, RECEIVED_PREVIEW_LIMIT) },
  });
}

/**
 * A stored double with a fraction, which a 64-bit integer codec cannot read. Such values were written through a Prisma 6 `Int` while its contract used the 32-bit codec, which took any number.
 */
export function refuseFractionalDouble(codecId: string, wire: number): never {
  return decodeFailed(
    codecId,
    `wire value is the fractional double ${wire}, and a 64-bit integer holds whole numbers only. Rewrite each such stored value as a long, rounded or cut off ({ $toLong: { $round: [<value>, 0] } }, or $trunc in place of $round), mapping over the list when the value sits in one. The upgrade guide step prisma6-int-written-as-long has the queries for a plain field, a list and a list of composite values.`,
    wire,
  );
}

function isLong(value: unknown): value is Long {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_bsontype' in value &&
    value._bsontype === 'Long'
  );
}

function outsideSafeRange(value: string | number | bigint): string {
  return `value must be an integer within the safe integer range, got ${String(value)}`;
}

function requireSafeInteger(value: bigint, fail: typeof decodeFailed): number {
  if (value < MIN_SAFE || value > MAX_SAFE) {
    return fail(MONGO_INT64_NUMBER_CODEC_ID, outsideSafeRange(value), value);
  }
  return Number(value);
}

export function int64NumberEncode(value: number): Long {
  if (typeof value !== 'number') {
    return encodeFailed(
      MONGO_INT64_NUMBER_CODEC_ID,
      `value must be a number, got ${typeof value} ${String(value)}`,
      value,
    );
  }
  if (!Number.isSafeInteger(value)) {
    return encodeFailed(MONGO_INT64_NUMBER_CODEC_ID, outsideSafeRange(value), value);
  }
  return Long.fromNumber(value);
}

/**
 * The driver hands a stored `long` over as a `number` when it fits in 53 bits (the default `promoteLongs`), as a `Long` otherwise or with `promoteLongs: false`, and as a `bigint` with `useBigInt64`.
 */
export function int64NumberDecode(wire: Long | number | bigint): number {
  if (typeof wire === 'bigint') return requireSafeInteger(wire, decodeFailed);
  if (isLong(wire)) return requireSafeInteger(wire.toBigInt(), decodeFailed);
  if (typeof wire === 'number') {
    if (Number.isSafeInteger(wire)) return wire;
    if (Number.isFinite(wire) && !Number.isInteger(wire)) {
      return refuseFractionalDouble(MONGO_INT64_NUMBER_CODEC_ID, wire);
    }
    return decodeFailed(MONGO_INT64_NUMBER_CODEC_ID, outsideSafeRange(wire), wire);
  }
  return decodeFailed(
    MONGO_INT64_NUMBER_CODEC_ID,
    'wire value must be a Long, a bigint or a number',
    wire,
  );
}

/** Decimal text, the JSON form every codec of the `mongo/int64` data type writes. */
export function int64NumberEncodeJson(value: number): string {
  return int64NumberEncode(value).toString();
}

export function int64NumberDecodeJson(json: JsonValue): number {
  if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
    return decodeFailed(MONGO_INT64_NUMBER_CODEC_ID, 'JSON value must be decimal text', json);
  }
  return requireSafeInteger(BigInt(json), decodeFailed);
}

/** Renders a decimal-text default as the number literal the field's `number` type takes. */
export function int64NumberLiteral(value: JsonValue): string | undefined {
  return typeof value === 'string' && DECIMAL_INTEGER.test(value) ? value : undefined;
}

/**
 * A BSON `long` read and written as a JavaScript `number` within ±(2^53 − 1), the value a Prisma 6 `Int` presents. It refuses a value outside that range and a non-integral value rather than rounding either.
 */
export const mongoInt64NumberCodec = mongoCodec({
  typeId: MONGO_INT64_NUMBER_CODEC_ID,
  decode: (wire: Long | number | bigint) => int64NumberDecode(wire),
  encode: (value: number): Long | number | bigint => int64NumberEncode(value),
  encodeJson: (value: number) => int64NumberEncodeJson(value),
  decodeJson: (json) => int64NumberDecodeJson(json),
});
