import type { TypeCastFunction } from 'mariadb';

/** MySQL's `binary` collation, which marks a string or blob column that holds bytes. */
const BINARY_COLLATION = 63;

/** The column types whose value is text, or bytes when the column's collation is binary. */
const TEXT_OR_BYTES = new Set([
  'VARCHAR',
  'VAR_STRING',
  'STRING',
  'TINY_BLOB',
  'MEDIUM_BLOB',
  'LONG_BLOB',
  'BLOB',
]);

/**
 * Hands the control plane the text MySQL sends for each column, over either protocol: a binary string or blob, BIT and GEOMETRY column as its bytes, and every other column, numbers, dates and JSON included, as text.
 */
export const serverText: TypeCastFunction = (field) => {
  if (field.type === 'BIT' || field.type === 'GEOMETRY') return field.buffer();
  if (TEXT_OR_BYTES.has(field.type) && field.collation.index === BINARY_COLLATION) {
    return field.buffer();
  }
  return field.string();
};
