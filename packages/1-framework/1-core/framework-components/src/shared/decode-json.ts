import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Readers for the JSON forms codecs share, each built as {@link Codec.decodeJson} requires: it returns the application value for a stored form of the codec's type and refuses anything else with {@link refuseJsonValue}.
 */

const RECEIVED_PREVIEW_LIMIT = 100;

/** The value a refusal names: its JSON text, or its digits for a number JSON cannot write, cut to 100 characters. */
function receivedPreview(json: JsonValue): string {
  const text = typeof json === 'number' ? String(json) : JSON.stringify(json);
  return text.slice(0, RECEIVED_PREVIEW_LIMIT);
}

/**
 * The refusal every `decodeJson` raises: `RUNTIME.DECODE_FAILED`, `<codecId> JSON value must be <expected>`, with `meta.codecId` and `meta.received`, the value it was given as JSON text, cut to 100 characters.
 */
export function refuseJsonValue(codecId: string, expected: string, json: JsonValue): never {
  throw structuredError('RUNTIME.DECODE_FAILED', `${codecId} JSON value must be ${expected}`, {
    meta: { codecId, received: receivedPreview(json) },
  });
}

export function decodeJsonString(codecId: string, json: JsonValue): string {
  if (typeof json !== 'string') return refuseJsonValue(codecId, 'a string', json);
  return json;
}

/** Reads a JSON string that matches `pattern`; `form` names what the pattern accepts, for the refusal. */
export function decodeJsonMatching(
  codecId: string,
  json: JsonValue,
  pattern: RegExp,
  form: string,
): string {
  if (typeof json !== 'string' || !pattern.test(json)) return refuseJsonValue(codecId, form, json);
  return json;
}

export function decodeJsonBoolean(codecId: string, json: JsonValue): boolean {
  if (typeof json !== 'boolean') return refuseJsonValue(codecId, 'a boolean', json);
  return json;
}

export interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

/** Whether `value` is an integer within `range`, its ends included. */
export function isIntegerIn(value: unknown, range: IntegerRange): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
  );
}

/** The integers a JavaScript `number` holds exactly. */
export const SAFE_INTEGER_RANGE: IntegerRange = {
  min: Number.MIN_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
};

/** The integers a signed 32-bit integer holds. */
export const INT32_RANGE: IntegerRange = { min: -(2 ** 31), max: 2 ** 31 - 1 };

export function decodeJsonInteger(codecId: string, json: JsonValue, range: IntegerRange): number {
  if (!isIntegerIn(json, range)) {
    return refuseJsonValue(codecId, `an integer from ${range.min} to ${range.max}`, json);
  }
  return json;
}

export interface BigIntRange {
  readonly min: bigint;
  readonly max: bigint;
}

/** The integers a signed 64-bit integer holds. */
export const INT64_RANGE: BigIntRange = { min: -(2n ** 63n), max: 2n ** 63n - 1n };

/** The integers a JavaScript `number` holds exactly, as a `bigint` range. */
export const SAFE_INTEGER_BIGINT_RANGE: BigIntRange = {
  min: BigInt(Number.MIN_SAFE_INTEGER),
  max: BigInt(Number.MAX_SAFE_INTEGER),
};

const DECIMAL_INTEGER_TEXT = /^-?\d+$/;

/** Reads an integer a codec writes as decimal text, because a JSON number cannot hold every value of its type. */
export function decodeJsonIntegerText(
  codecId: string,
  json: JsonValue,
  range?: BigIntRange,
): bigint {
  const expected =
    range === undefined
      ? 'a decimal integer string'
      : `a decimal integer string from ${range.min} to ${range.max}`;
  const value = BigInt(decodeJsonMatching(codecId, json, DECIMAL_INTEGER_TEXT, expected));
  if (range !== undefined && (value < range.min || value > range.max)) {
    return refuseJsonValue(codecId, expected, json);
  }
  return value;
}

const NON_FINITE_TEXT: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);

/** Whether `text` is `NaN`, `Infinity` or `-Infinity`, the text a float's JSON form writes for a value JSON has no number for. */
export function isNonFiniteText(text: string): boolean {
  return NON_FINITE_TEXT.has(text);
}

/** JSON has no number for NaN or an infinity, so a float's JSON form writes them as the text `NaN`, `Infinity` and `-Infinity`. */
export function encodeJsonFloat(value: number): JsonValue {
  return Number.isFinite(value) ? value : String(value);
}

export function decodeJsonFloat(codecId: string, json: JsonValue): number {
  if (typeof json === 'number' && Number.isFinite(json)) return json;
  if (typeof json === 'string' && isNonFiniteText(json)) return Number(json);
  return refuseJsonValue(codecId, 'a finite number or the text NaN, Infinity or -Infinity', json);
}
