import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';

/**
 * Readers for the JSON forms codecs share, each built as {@link Codec.decodeJson} requires: it returns the application value for a stored form of the codec's type and refuses anything else with {@link refuseJsonValue}.
 */

export type JsonKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

export function jsonKind(json: JsonValue): JsonKind {
  if (json === null) return 'null';
  if (Array.isArray(json)) return 'array';
  switch (typeof json) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/**
 * The refusal every `decodeJson` raises: `RUNTIME.DECODE_FAILED`, `<codecId> JSON value must be <expected>`, with `meta.codecId` and `meta.received`, the kind of JSON value it was given.
 */
export function refuseJsonValue(codecId: string, expected: string, json: JsonValue): never {
  throw structuredError('RUNTIME.DECODE_FAILED', `${codecId} JSON value must be ${expected}`, {
    meta: { codecId, received: jsonKind(json) },
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

/** The integers a JavaScript `number` holds exactly. */
export const SAFE_INTEGER_RANGE: IntegerRange = {
  min: Number.MIN_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
};

export function decodeJsonInteger(codecId: string, json: JsonValue, range: IntegerRange): number {
  if (typeof json !== 'number' || !Number.isInteger(json) || json < range.min || json > range.max) {
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

/**
 * JSON has no number for NaN or an infinity, so a float's JSON form writes them as the text `NaN`, `Infinity` and `-Infinity`, which is also how PostgreSQL writes them in JSON.
 */
export function encodeJsonFloat(value: number): JsonValue {
  return Number.isFinite(value) ? value : String(value);
}

export function decodeJsonFloat(codecId: string, json: JsonValue): number {
  if (typeof json === 'number') return json;
  if (typeof json === 'string' && NON_FINITE_TEXT.has(json)) return Number(json);
  return refuseJsonValue(codecId, 'a number or the text NaN, Infinity or -Infinity', json);
}
