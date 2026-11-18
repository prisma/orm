/**
 * How a written number is canonicalised and which data type of a target holds it. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeId } from './data-type';
import { isNonFiniteText } from './json-readers';

const WRITTEN_INTEGER_TEXT = /^[+-]?\d+$/;
const WRITTEN_DECIMAL_TEXT = /^[+-]?\d+\.\d+$/;
const DECIMAL_NUMERAL = /^([+-]?)0*(\d+)(\.\d+)?$/;

/** Whether `text` is a whole number or a decimal as a contract source writes one. */
export function isNumeralText(text: string): boolean {
  return WRITTEN_INTEGER_TEXT.test(text) || WRITTEN_DECIMAL_TEXT.test(text);
}

/**
 * A written numeral as the contract stores it. Leading zeros and the sign of zero never change a
 * number, so they go; trailing zeros stay, because a type without a scale keeps them.
 */
export function storedNumeralText(text: string): string {
  const numeral = DECIMAL_NUMERAL.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = ''] = numeral;
  const digits = `${whole}${fraction}`;
  return sign !== '-' || /^[0.]+$/.test(digits) ? digits : `-${digits}`;
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
 * which of the target's types the value is, in that type's stored form. `undefined` means no
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
    if (isNonFiniteText(text)) {
      return as(spec.words, spec.words?.form === 'number' ? Number(text) : text);
    }
    if (WRITTEN_DECIMAL_TEXT.test(text)) {
      const canonical = storedNumeralText(text);
      return as(spec.fraction, spec.fraction?.form === 'number' ? Number(canonical) : canonical);
    }
    if (!WRITTEN_INTEGER_TEXT.test(text)) return undefined;
    const digits = BigInt(text);
    const step = spec.integers.find(({ min, max }) => digits >= min && digits <= max);
    const classification = step ?? spec.largerWhole;
    return as(
      classification,
      classification?.form === 'number' ? Number(digits) : digits.toString(),
    );
  };
}
