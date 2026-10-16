/**
 * The data type this extension owns.
 *
 * A vector is one value holding several numbers, so it takes a written list through a list cast
 * rather than casting from any scalar type: each element must be one of the target's numeric types,
 * and the cast turns the elements into the numbers a vector stores. Its canonical form is that array
 * of numbers, which it also reads from the text PostgreSQL prints, so a default the database reports
 * compares equal to the one the contract stores. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type DataType,
  isNonFiniteText,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgInt2, pgInt4, pgInt8, pgNumeric } from '@internal/target-postgres/data-types';
import { structuredError } from '@internal/utils/structured-error';
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

const PRINTED_VECTOR = /^\[(.*)\]$/s;
const PRINTED_ELEMENT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isFiniteNumber(element: JsonValue): element is number {
  return typeof element === 'number' && Number.isFinite(element);
}

function printedVector(text: string): readonly number[] | undefined {
  const body = PRINTED_VECTOR.exec(text)?.[1]?.trim();
  if (body === undefined) return undefined;
  if (body === '') return [];
  const entries = body.split(',').map((entry) => entry.trim());
  return entries.every((entry) => PRINTED_ELEMENT.test(entry)) ? entries.map(Number) : undefined;
}

const vectorCanonicalForm: ToCanonicalForm = (value) => {
  const elements = typeof value === 'string' ? printedVector(value) : value;
  if (Array.isArray(elements) && elements.every(isFiniteNumber)) {
    return elements.map((element) => (Object.is(element, -0) ? 0 : element));
  }
  throw structuredError(
    'CONTRACT.CAST_REFUSED',
    `A vector is an array of finite numbers, or the text PostgreSQL prints for one, as in "[1,2,3]". ${JSON.stringify(value)} is neither.`,
    {
      why: 'pgvector/vector stores a vector as its array of numbers (ADR 254), and reads that array and the text PostgreSQL prints.',
      fix: 'Write the vector as an array of numbers, as in [1, 2, 3].',
    },
  );
};

export const pgvectorVectorParams = arktype({
  'length?': `number.integer >= 1 & number.integer <= ${VECTOR_MAX_DIM}` as const,
});

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [
    { text: 'vector', written: true, catalog: true },
    { text: 'vector({length})', written: true, catalog: true },
  ],
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
  toCanonicalForm: vectorCanonicalForm,
});

export const pgvectorDataTypes: readonly DataType[] = [pgvectorVector];
