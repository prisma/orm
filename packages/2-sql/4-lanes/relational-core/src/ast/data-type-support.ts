/**
 * Shared implementations every SQL target uses to declare its data types and their PSL support.
 *
 * The family registers no data types of its own: a data type is a database type, and every database
 * type belongs to a target or an extension. What the family owns is the arithmetic every SQL target
 * repeats — how a written number is canonicalised, which integer type holds it, and how a JSON body
 * is read and written.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeId } from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+\.\d+$/;
const NON_FINITE_WORDS: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);
const DECIMAL_NUMERAL = /^(-?)0*(\d+)(\.\d+)?$/;

/** Whether `text` is a whole number or a decimal as a contract source writes one. */
export function isNumeralText(text: string): boolean {
  return INTEGER_TEXT.test(text) || DECIMAL_TEXT.test(text);
}

/** Whether `text` is one of the three words a floating-point value is written as. */
export function isNonFiniteText(text: string): boolean {
  return NON_FINITE_WORDS.has(text);
}

/**
 * A written numeral as the contract stores it. Leading zeros and the sign of zero never change a
 * number, so they go; trailing zeros stay, because a type without a scale keeps them.
 */
export function canonicalNumeralText(text: string): string {
  const numeral = DECIMAL_NUMERAL.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = ''] = numeral;
  const digits = `${whole}${fraction}`;
  return /^[0.]+$/.test(digits) ? digits : `${sign}${digits}`;
}

/**
 * A number as a contract source writes it: no exponent, because no schema language has that syntax,
 * so the decimal point moves to where the exponent puts it. A non-finite number is its own word.
 */
export function numeralText(value: number): string {
  const [coefficient = '', exponent] = String(value).split('e');
  if (exponent === undefined) return coefficient;
  const sign = coefficient.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = coefficient.slice(sign.length).split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** A string as a contract source writes it, with the escapes its string reader resolves. */
export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Which data type a written number is, and whether that type stores it as a number or as text. */
export interface NumberClassification {
  readonly type: DataTypeId;
  readonly form: 'number' | 'text';
}

/** One integer type and the range of whole numbers it holds. */
export interface IntegerStep extends NumberClassification {
  readonly min: bigint;
  readonly max: bigint;
}

/** The range of a signed integer of `bits` bits. */
export function signedRange(bits: number): { readonly min: bigint; readonly max: bigint } {
  const half = 2n ** (BigInt(bits) - 1n);
  return { min: -half, max: half - 1n };
}

export interface NumberClassifierSpec {
  /** Tried in order; the first whose range holds the digits wins. */
  readonly integers: readonly IntegerStep[];
  /** A whole number no step holds. Absent means the target has no type for it. */
  readonly largerWhole?: NumberClassification | undefined;
  /** A number with a fraction. Absent means the target has no type for it. */
  readonly fraction?: NumberClassification | undefined;
  /** `NaN`, `Infinity` and `-Infinity`. Absent means the target has no type for them. */
  readonly words?: NumberClassification | undefined;
}

/**
 * The classifier one target's plain-number authoring entry carries: it reads the digits and says
 * which of the target's types the value is, in that type's canonical form. `undefined` means no
 * type of this target holds the number.
 */
export function createNumberClassifier(
  spec: NumberClassifierSpec,
): (text: string) => { readonly type: DataTypeId; readonly value: JsonValue } | undefined {
  const as = (
    classification: NumberClassification | undefined,
    value: JsonValue,
  ): { readonly type: DataTypeId; readonly value: JsonValue } | undefined =>
    classification === undefined ? undefined : { type: classification.type, value };

  return (text) => {
    if (NON_FINITE_WORDS.has(text)) {
      return as(spec.words, spec.words?.form === 'number' ? Number(text) : text);
    }
    if (DECIMAL_TEXT.test(text)) {
      const canonical = canonicalNumeralText(text);
      return as(spec.fraction, spec.fraction?.form === 'number' ? Number(canonical) : canonical);
    }
    if (!INTEGER_TEXT.test(text)) return undefined;
    const digits = BigInt(text);
    const step = spec.integers.find(({ min, max }) => digits >= min && digits <= max);
    const classification = step ?? spec.largerWhole;
    return as(
      classification,
      classification?.form === 'number' ? Number(digits) : digits.toString(),
    );
  };
}

/**
 * Read a JSON body into the document it holds.
 *
 * `JSON.parse` reads a numeral too large for a double as `Infinity`, and `JSON.stringify` writes
 * that back as `null`, so a document holding one would not be the document stored; it is refused
 * here instead, naming where the number is.
 */
export function parseJsonBody(text: string): JsonValue {
  let value: JsonValue;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw structuredError(
      'CONTRACT.INVALID_JSON_LITERAL',
      error instanceof Error ? error.message : String(error),
      { why: 'The body is not a JSON document.', fix: 'Write a JSON document.' },
    );
  }
  const overflowed = nonFiniteNumberIn(value, '');
  if (overflowed !== undefined) {
    throw structuredError(
      'CONTRACT.INVALID_JSON_LITERAL',
      `${overflowed.path} is ${overflowed.value}, which JSON cannot write back: the number in the text is outside the range a JSON number holds.`,
      {
        why: 'JSON.parse reads a numeral too large for a double as Infinity, which JSON.stringify writes back as null.',
        fix: 'Write a number JSON can hold, or write it as text.',
      },
    );
  }
  return value;
}

/** Write a document as the body of a JSON literal. */
export function printJsonBody(value: JsonValue): string {
  return JSON.stringify(value);
}

function nonFiniteNumberIn(
  value: JsonValue,
  path: string,
): { readonly path: string; readonly value: number } | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : { path: path === '' ? 'The value' : path, value };
  }
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const found = nonFiniteNumberIn(element, `${path}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, member] of Object.entries(value)) {
      const found = nonFiniteNumberIn(member, path === '' ? key : `${path}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
