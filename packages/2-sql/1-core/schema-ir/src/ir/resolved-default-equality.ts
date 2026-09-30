import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { defaultInCanonicalForm } from './default-in-canonical-form';

/**
 * Structural equality for two resolved column defaults, ported from the relational walk's
 * `columnDefaultsEqual` normalized branch: kinds must match; literal values are normalized (a
 * value of a type with a canonical form, such as a date or time type or a 64-bit integer type, to
 * that form through `toCanonicalForm`; a numeric native type's number to its decimal text, and when the type has
 * a modifier, its decimal text to its digits without zeros that do not change the value; a list
 * element by element under its element type) then compared canonically (JSON objects match their
 * canonical string form); function expressions compare case- and whitespace-insensitively.
 *
 * `nativeType` provides the normalization context (the actual side's resolved native type in a diff
 * comparison). `toCanonicalForm` is the column data type's canonical-form function (ADR 254), from the
 * assembled stack; a value it refuses compares as it is. A target that reads a raw
 * expression as a literal does so before this comparison, through its `resolveDefault` hook.
 */
export function resolvedDefaultsEqual(
  expected: ColumnDefault,
  actual: ColumnDefault,
  nativeType?: string,
  toCanonicalForm?: ToCanonicalForm,
): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'literal' && actual.kind === 'literal') {
    return literalValuesEqual(
      normalizeLiteralValue(expected.value, nativeType, toCanonicalForm),
      normalizeLiteralValue(actual.value, nativeType, toCanonicalForm),
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

/**
 * A numeric type with a modifier (`numeric(10,2)`, or `numeric(5,-2)` with the negative scale
 * PostgreSQL 15 and later accept) stores every value at its scale, so zeros that do not change the
 * value do not count. Without one, the value keeps the scale it was written with.
 */
const DECIMAL_NATIVE_TYPE = /^(?:numeric|decimal)(\(\d+(?:,\s*-?\d+)?\))?$/i;
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

function normalizeLiteralValue(
  value: ColumnDefaultLiteralInputValue,
  nativeType: string | undefined,
  toCanonicalForm: ToCanonicalForm | undefined,
): unknown {
  if (Array.isArray(value) && nativeType?.endsWith('[]')) {
    const elementType = nativeType.slice(0, -2);
    return value.map((element) => normalizeLiteralValue(element, elementType, toCanonicalForm));
  }
  const json = value instanceof Date ? value.toISOString() : value;
  if (toCanonicalForm !== undefined) {
    return defaultInCanonicalForm(json, toCanonicalForm, false).value;
  }
  if (value instanceof Date) {
    return json;
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
