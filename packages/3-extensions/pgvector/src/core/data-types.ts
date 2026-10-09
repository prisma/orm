/**
 * The data type this extension owns.
 *
 * A vector is one value holding several numbers, so it takes a written list through a list cast
 * rather than casting from any scalar type: each element must be one of the target's numeric types,
 * and the cast turns the elements into the numbers a vector stores. Its stored form is that array
 * of numbers, which it also reads from the text PostgreSQL prints, so a default the database reports
 * compares equal to the one the contract stores. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type DataType,
  type DataTypeReader,
  isNonFiniteText,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgInt2, pgInt4, pgInt8, pgNumeric } from '@internal/target-postgres/data-types';
import { structuredError } from '@internal/utils/structured-error';
import { counted } from '@internal/utils/text';
import { type as arktype } from 'arktype';
import { VECTOR_MAX_DIM } from './constants';

function elementNumber(element: JsonValue): number {
  if (typeof element === 'number') return element;
  if (typeof element === 'string' && !isNonFiniteText(element)) {
    const converted = Number(element);
    if (Number.isFinite(converted)) return converted;
  }
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `A vector holds finite numbers, and ${JSON.stringify(element)} is not one.`,
    {
      why: 'A vector element is a finite number; NaN and the two infinities have no place in one.',
      fix: 'Use a finite number for every element.',
    },
  );
}

export const pgvectorVectorParams = arktype({
  'length?': `number.integer >= 1 & number.integer <= ${VECTOR_MAX_DIM}` as const,
});

/** A `vector(n)` value is an array of exactly `n` finite numbers, and a `vector` value one of 1 to 16,000, each one a `real` holds exactly. */
function isFiniteNumber(element: JsonValue): element is number {
  return typeof element === 'number' && Number.isFinite(element);
}

const readVector: DataTypeReader = (json, params) => {
  const length = typeof params['length'] === 'number' ? params['length'] : undefined;
  const expected =
    length === undefined
      ? `an array of 1 to ${VECTOR_MAX_DIM} finite numbers`
      : `an array of ${counted(length, 'finite number')}`;
  const acceptsLength = (received: number) =>
    length === undefined ? received >= 1 && received <= VECTOR_MAX_DIM : received === length;
  if (!Array.isArray(json) || !acceptsLength(json.length)) {
    return refuseJsonValue('pgvector/vector', expected, json);
  }
  if (!json.every(isFiniteNumber)) return refuseJsonValue('pgvector/vector', expected, json);
  for (const [index, element] of json.entries()) {
    const refuse = (why: string) =>
      refuseJsonValue(
        'pgvector/vector',
        `an array of numbers real holds exactly; element ${index + 1}, ${element}, ${why}`,
        json,
      );
    if (!Number.isFinite(Math.fround(element))) {
      return refuse('is outside the range real holds, which PostgreSQL refuses');
    }
    const stored = realText(element);
    if (Number(stored) !== element) return refuse(`would be stored as ${stored}`);
  }
  return json;
};

/**
 * The text PostgreSQL prints for `value` stored as a `real`, which is what a row reads back: the shortest decimal that reads back as the same single-precision number.
 */
function realText(value: number): string {
  const single = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(single.toPrecision(digits)));
    if (Math.fround(Number(text)) === single) return text;
  }
  return String(single);
}

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  read: readVector,
  texts: [
    { text: 'vector', written: true, catalog: true },
    { text: 'vector({length})', written: true, catalog: true },
  ],
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});

export const pgvectorDataTypes: readonly DataType[] = [pgvectorVector];
