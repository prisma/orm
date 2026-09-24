/**
 * The data type this extension owns.
 *
 * A vector is one value holding several numbers, so it takes a written list through a list cast
 * rather than casting from any scalar type: each element must be one of the target's numeric types,
 * and the cast turns the elements into the numbers a vector stores. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { type DataType, dataType } from '@internal/framework-components/codec';
import { isNonFiniteText } from '@internal/sql-relational-core/ast';
import { pgInt2, pgInt4, pgInt8, pgNumeric } from '@internal/target-postgres/data-types';
import { structuredError } from '@internal/utils/structured-error';

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

export const pgvectorVector: DataType = dataType('pgvector/vector', {
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});

export const pgvectorDataTypes: readonly DataType[] = [pgvectorVector];
