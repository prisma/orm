import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';
import { DATA_TYPE_ID_PATTERN } from './data-type';

/**
 * Readers for the JSON forms data types share. Each returns the JSON it is given in a form it reads and refuses anything else with {@link refuseJsonValue}. `owner` is the data type whose value is read, or the codec whose own limit refuses it.
 */

const RECEIVED_PREVIEW_LIMIT = 100;

/** The value a refusal names: its JSON text, or its digits for a number JSON cannot write, cut to 100 characters. */
function receivedPreview(json: JsonValue): string {
  const text = typeof json === 'number' ? String(json) : JSON.stringify(json);
  return text.slice(0, RECEIVED_PREVIEW_LIMIT);
}

/**
 * The refusal of a JSON value: `RUNTIME.DECODE_FAILED`, `<owner> JSON value must be <expected>`, with `meta.received`, the value it was given as JSON text, cut to 100 characters, and `meta.dataType` or `meta.codecId` naming the owner. A data type id carries no version and a codec id does, so the id says which it is.
 */
export function refuseJsonValue(owner: string, expected: string, json: JsonValue): never {
  const named = DATA_TYPE_ID_PATTERN.test(owner) ? { dataType: owner } : { codecId: owner };
  throw structuredError('RUNTIME.DECODE_FAILED', `${owner} JSON value must be ${expected}`, {
    meta: { ...named, received: receivedPreview(json) },
  });
}

export function readJsonString(owner: string, json: JsonValue): string {
  if (typeof json !== 'string') return refuseJsonValue(owner, 'a string', json);
  return json;
}

/** Reads a JSON string that matches `pattern`; `form` names what the pattern accepts, for the refusal. */
export function readJsonMatching(
  owner: string,
  json: JsonValue,
  pattern: RegExp,
  form: string,
): string {
  if (typeof json !== 'string' || !pattern.test(json)) return refuseJsonValue(owner, form, json);
  return json;
}

export function readJsonBoolean(owner: string, json: JsonValue): boolean {
  if (typeof json !== 'boolean') return refuseJsonValue(owner, 'a boolean', json);
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

export function readJsonInteger(owner: string, json: JsonValue, range: IntegerRange): number {
  if (!isIntegerIn(json, range)) {
    return refuseJsonValue(owner, `an integer from ${range.min} to ${range.max}`, json);
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

/**
 * Reads an integer a codec writes as decimal text, because a JSON number cannot hold every value of its type. The text must be the integer's decimal text, with no leading zeros and no minus sign on zero; another spelling is refused with the text to write, as `"7"` for `"007"`.
 */
export function readJsonIntegerText(owner: string, json: JsonValue, range?: BigIntRange): bigint {
  const expected =
    range === undefined
      ? 'a decimal integer string'
      : `a decimal integer string from ${range.min} to ${range.max}`;
  const value = BigInt(readJsonMatching(owner, json, DECIMAL_INTEGER_TEXT, expected));
  if (range !== undefined && (value < range.min || value > range.max)) {
    return refuseJsonValue(owner, expected, json);
  }
  const written = value.toString();
  if (json !== written) {
    return refuseJsonValue(
      owner,
      `"${written}", the integer's decimal text without leading zeros or a minus sign on zero`,
      json,
    );
  }
  return value;
}

const NON_FINITE_TEXT: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);

/** Whether `text` is `NaN`, `Infinity` or `-Infinity`, the text a float's JSON form writes for a value JSON has no number for. */
export function isNonFiniteText(text: string): boolean {
  return NON_FINITE_TEXT.has(text);
}

/** JSON has no number for NaN or an infinity, so a float's JSON form writes them as the text `NaN`, `Infinity` and `-Infinity`. */
export function floatToJson(value: number): JsonValue {
  return Number.isFinite(value) ? value : String(value);
}

export function readJsonFloat(owner: string, json: JsonValue): number {
  if (typeof json === 'number' && Number.isFinite(json)) return json;
  if (typeof json === 'string' && isNonFiniteText(json)) return Number(json);
  return refuseJsonValue(owner, 'a finite number or the text NaN, Infinity or -Infinity', json);
}
