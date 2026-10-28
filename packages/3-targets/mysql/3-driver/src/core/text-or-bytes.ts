import type { TypeCastFunction } from 'mariadb';

/** MySQL's `binary` collation, which marks a string or blob column that holds bytes. */
const BINARY_COLLATION = 63;

/** The column types whose value is text, or bytes when the column's collation is binary. */
const CHARACTER_OR_BLOB_TYPES = new Set([
  'VARCHAR',
  'VAR_STRING',
  'STRING',
  'TINY_BLOB',
  'MEDIUM_BLOB',
  'LONG_BLOB',
  'BLOB',
]);

/**
 * Reads each column as the row value ADR 155 sets at the driver boundary: a binary string or blob, BIT and GEOMETRY column as its bytes, every other column as text, and NULL as `null`. Over the text protocol the text is what MySQL sends. Under a prepared statement MySQL sends numbers, dates and times in binary, and the package writes them as text: an integer as its decimal digits, a FLOAT as the decimal text of the double it widens to, a DOUBLE as JavaScript prints it, a DATETIME with the column's fraction digits, and a TIME with six fraction digits when it has any.
 */
export const readTextOrBytes: TypeCastFunction = (field) => {
  if (field.type === 'BIT' || field.type === 'GEOMETRY') return field.buffer();
  if (CHARACTER_OR_BLOB_TYPES.has(field.type) && field.collation.index === BINARY_COLLATION) {
    return field.buffer();
  }
  return field.string();
};
