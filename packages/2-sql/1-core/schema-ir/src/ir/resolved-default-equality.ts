import type { ColumnDefault } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

/**
 * Structural equality for two resolved column defaults, ported from the relational walk's
 * `columnDefaultsEqual` normalized branch: kinds must match; literal values are normalized (Date
 * and temporal-typed strings to ISO instants, with a timestamp that has no zone read as UTC; a
 * 64-bit-integer native type's safe-integer number to its decimal-text spelling; a numeric native
 * type's number to its decimal text, and when the type has a modifier, its decimal text to its
 * digits without zeros that do not change the value; a list element by element under its element
 * type) then compared canonically (JSON objects match their canonical string form); function
 * expressions compare case- and whitespace-insensitively.
 *
 * `nativeType` provides the normalization context (the actual side's resolved native type in a diff
 * comparison). A target that reads a raw expression as a literal does so before this comparison,
 * through its `resolveDefault` hook.
 */
export function resolvedDefaultsEqual(
  expected: ColumnDefault,
  actual: ColumnDefault,
  nativeType?: string,
): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'literal' && actual.kind === 'literal') {
    return literalValuesEqual(
      normalizeLiteralValue(expected.value, nativeType),
      normalizeLiteralValue(actual.value, nativeType),
    );
  }
  if (expected.kind === 'function' && actual.kind === 'function') {
    return (
      normalizeFunctionExpression(expected.expression) ===
      normalizeFunctionExpression(actual.expression)
    );
  }
  return false;
}

function normalizeFunctionExpression(expression: string): string {
  return expression.toLowerCase().replace(/\s+/g, '');
}

function isTemporalNativeType(nativeType?: string): boolean {
  if (!nativeType) return false;
  const normalized = nativeType.toLowerCase();
  return normalized.includes('timestamp') || normalized === 'date';
}

function isInt64NativeType(nativeType?: string): boolean {
  if (!nativeType) return false;
  const normalized = nativeType.toLowerCase();
  return normalized === 'int8' || normalized === 'bigint';
}

/**
 * A numeric type with a modifier (`numeric(10,2)`) stores every value at its scale, so zeros that
 * do not change the value do not count. Without one, the value keeps the scale it was written with.
 */
const DECIMAL_NATIVE_TYPE = /^(?:numeric|decimal)(\(\d+(?:,\s*\d+)?\))?$/i;
const DECIMAL_NUMERAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const EXPONENT_NUMERAL = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

/**
 * The plain decimal spelling of a value, so that a number JavaScript prints as `1e-7` or `1e+21`
 * can be compared with the decimal text a numeric column stores. No digit is added or dropped;
 * only the decimal point moves.
 */
function decimalText(value: string | number): string {
  const text = String(value);
  const numeral = EXPONENT_NUMERAL.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = numeral;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function decimalDigits(value: string | number): string | number {
  const numeral = DECIMAL_NUMERAL.exec(decimalText(value));
  if (numeral === null) return value;
  const whole = (numeral[2] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (numeral[3] ?? '').replace(/0+$/, '');
  const digits = fraction === '' ? whole : `${whole}.${fraction}`;
  return digits === '0' ? digits : `${numeral[1] ?? ''}${digits}`;
}

/**
 * A timestamp as Postgres prints it, with or without an offset: `2024-01-01 00:00:00`,
 * `0001-01-01 00:00:00+00`, `2024-01-02 03:04:05+05:30`. It is rebuilt as an ISO string before
 * `Date` reads it, because `Date` reads this spelling without a zone as host-local time and reads a
 * year below 100 as 19xx or 20xx. A value without a zone is a wall-clock time, and the contract
 * spells the same wall time as an ISO instant, so it is read as UTC.
 */
const POSTGRES_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:([+-]\d{2})(?::?(\d{2}))?)?$/;

function parseTemporal(value: string): Date {
  const timestamp = POSTGRES_TIMESTAMP.exec(value);
  if (timestamp === null) return new Date(value);
  const [, date, time, offsetHours, offsetMinutes = '00'] = timestamp;
  const zone = offsetHours === undefined ? 'Z' : `${offsetHours}:${offsetMinutes}`;
  return new Date(`${date}T${time}${zone}`);
}

function normalizeLiteralValue(value: unknown, nativeType?: string): unknown {
  if (Array.isArray(value) && nativeType?.endsWith('[]')) {
    const elementType = nativeType.slice(0, -2);
    return value.map((element) => normalizeLiteralValue(element, elementType));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && isTemporalNativeType(nativeType)) {
    const parsed = parseTemporal(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && isInt64NativeType(nativeType)) {
    return String(value);
  }
  const decimalType = nativeType === undefined ? null : DECIMAL_NATIVE_TYPE.exec(nativeType);
  if ((typeof value === 'number' || typeof value === 'string') && decimalType !== null) {
    return decimalType[1] === undefined ? decimalText(value) : decimalDigits(value);
  }
  return value;
}

function literalValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return canonicalStringify(a) === canonicalStringify(b);
  }
  if (typeof a === 'object' && a !== null && typeof b === 'string') {
    try {
      return canonicalStringify(a) === canonicalStringify(JSON.parse(b));
    } catch {
      return false;
    }
  }
  if (typeof a === 'string' && typeof b === 'object' && b !== null) {
    try {
      return canonicalStringify(JSON.parse(a)) === canonicalStringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
