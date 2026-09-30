import type { IntegerRange } from '@internal/framework-components/codec';

/** The precision a `numeric` column takes. */
export const NUMERIC_PRECISION_RANGE: IntegerRange = { min: 1, max: 1000 };

/** The scale a `numeric` column takes in PostgreSQL 15 and later, including a negative one and one above the precision. */
export const NUMERIC_SCALE_RANGE: IntegerRange = { min: -1000, max: 1000 };

/** Whether `value` is an integer within `range`. */
export function isIntegerIn(value: unknown, range: IntegerRange): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
  );
}
