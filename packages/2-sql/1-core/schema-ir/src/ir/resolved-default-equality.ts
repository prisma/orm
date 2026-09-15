import type { ColumnDefault } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

/**
 * Structural equality for two resolved column defaults, ported from the relational walk's
 * `columnDefaultsEqual` normalized branch: kinds must match; literal values are normalized (Date
 * and temporal-typed strings to ISO instants, with a timestamp that has no zone read as UTC; a
 * 64-bit-integer native type's safe-integer number to its decimal-text spelling; a numeric native
 * type's number or decimal text to its digits without zeros that do not change the value; a list
 * element by element under its element type) then compared canonically (JSON objects match their
 * canonical string form); function expressions compare case- and whitespace-insensitively.
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

function isDecimalNativeType(nativeType?: string): boolean {
  return (
    nativeType !== undefined && /^(?:numeric|decimal)(?:\(\d+(?:,\s*\d+)?\))?$/i.test(nativeType)
  );
}

const DECIMAL_NUMERAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function decimalDigits(value: string | number): string | number {
  const numeral = DECIMAL_NUMERAL.exec(String(value));
  if (numeral === null) return value;
  const whole = (numeral[2] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (numeral[3] ?? '').replace(/0+$/, '');
  const digits = fraction === '' ? whole : `${whole}.${fraction}`;
  return digits === '0' ? digits : `${numeral[1] ?? ''}${digits}`;
}

/**
 * A timestamp spelled without a zone, as Postgres reports a `timestamp
 * without time zone` default: `2024-01-01 00:00:00`, `2024-01-01T00:00:00.5`.
 * `Date` would read that as host-local time, so it is pinned to UTC first —
 * the value is a wall-clock time and the contract spells the same wall time
 * as an ISO instant.
 */
const ZONELESS_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

function parseTemporal(value: string): Date {
  const zoneless = ZONELESS_TIMESTAMP.exec(value);
  return zoneless === null ? new Date(value) : new Date(`${zoneless[1]}T${zoneless[2]}Z`);
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
  if ((typeof value === 'number' || typeof value === 'string') && isDecimalNativeType(nativeType)) {
    return decimalDigits(value);
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
