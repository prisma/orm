import type { DataTypeValue } from '@internal/framework-components/codec';
import { dataTypeValuesEqual } from '@internal/framework-components/codec';

/**
 * A literal default as a value of its column's data type: one value, or for a list column its elements, with `null` for an element that is SQL NULL. ADR 254.
 */
export type SqlDefaultValue = DataTypeValue | readonly (DataTypeValue | null)[];

function isList(value: SqlDefaultValue): value is readonly (DataTypeValue | null)[] {
  return Array.isArray(value);
}

/** Whether two defaults are one value: the same type, parameters and value, element by element for a list. */
export function sqlDefaultValuesEqual(a: SqlDefaultValue, b: SqlDefaultValue): boolean {
  if (!isList(a) || !isList(b)) {
    return !isList(a) && !isList(b) && dataTypeValuesEqual(a, b);
  }
  return (
    a.length === b.length &&
    a.every((element, index) => {
      const other = b[index];
      if (element === null || other === null || other === undefined) return element === other;
      return dataTypeValuesEqual(element, other);
    })
  );
}
