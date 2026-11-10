/**
 * Casts several targets declare. Each is a pure function from the source type's stored form to the receiving type's. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';
import type { Cast } from './data-type';
import { isNonFiniteText } from './json-readers';
import { numeralText } from './numeral-text';

/** A cast between two types that store the same shape: the value is already the form this type stores. */
export const castUnchanged: Cast = (value) => value;

/** Refuses a value that is not in the shape the cast's source type stores. */
export function refuseWrongShape(value: JsonValue, expected: string): never {
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `Expected ${expected}, got ${JSON.stringify(value)}.`,
    {
      why: 'A cast reads the stored form of the type it takes values of.',
      fix: 'Hand the cast a value in the shape its source type stores.',
    },
  );
}

/** A whole number as the digit text a 64-bit integer or decimal type stores. */
export const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : refuseWrongShape(value, 'a number');

/**
 * A number as the floating-point types store it: a JSON number, or one of the three words, which
 * those types keep as text. A magnitude past what a double holds is refused rather than rounded to
 * a word: the database refuses it too, and storing `Infinity` would make a written number
 * indistinguishable from a written `Infinity`.
 */
export const asFloat: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return refuseWrongShape(value, 'a number or numeral text');
  if (isNonFiniteText(value)) return value;
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `${value} is out of range: no double holds a number that large.`,
    {
      why: 'The floating-point types store a double, which holds magnitudes up to about 1.8e308.',
      fix: 'Use a number a double holds, or a decimal type.',
    },
  );
};
