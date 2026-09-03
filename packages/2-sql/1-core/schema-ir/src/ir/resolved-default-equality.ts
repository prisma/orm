import type { ColumnDefault } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';

/**
 * Structural equality for two resolved column defaults, ported from the
 * relational walk's `columnDefaultsEqual` normalized branch: kinds must
 * match; literal values are normalized (Date and temporal-typed strings to
 * ISO instants, and a 64-bit-integer native type's safe-integer number to
 * its decimal-text spelling) then compared canonically (JSON objects match
 * their canonical string form); function expressions compare case- and
 * whitespace-insensitively.
 *
 * `nativeType` provides the temporal- and int64-normalization context (the
 * actual side's resolved native type in a diff comparison).
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

function normalizeLiteralValue(value: unknown, nativeType?: string): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && isTemporalNativeType(nativeType)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && isInt64NativeType(nativeType)) {
    return String(value);
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
