import type { TypeCastFunction } from 'mariadb';

/** MySQL's `binary` collation, which marks a string or blob column that holds bytes. */
const BINARY_COLLATION = 63;

/** The column types whose value is text, or bytes when the column's collation is binary. */
const CHARACTER_OR_BLOB_TYPES: ReadonlySet<string> = new Set([
  'VARCHAR',
  'VAR_STRING',
  'STRING',
  'TINY_BLOB',
  'MEDIUM_BLOB',
  'LONG_BLOB',
  'BLOB',
]);

/** The column types whose value MySQL sends as text. A type outside this list, such as BIT, GEOMETRY or one the package has no name for, is read as bytes. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  ...CHARACTER_OR_BLOB_TYPES,
  'DECIMAL',
  'NEWDECIMAL',
  'FLOAT',
  'DOUBLE',
  'TINY',
  'SHORT',
  'INT',
  'INT24',
  'BIGINT',
  'YEAR',
  'DATE',
  'NEWDATE',
  'TIME',
  'TIME2',
  'DATETIME',
  'DATETIME2',
  'TIMESTAMP',
  'TIMESTAMP2',
  'JSON',
  'ENUM',
  'SET',
  'NULL',
]);

/**
 * Reads each column as the row value ADR 155 sets at the driver boundary: a binary string or blob, BIT, GEOMETRY and a column of a type the package does not know as its bytes, every other column as text, and NULL as `null`. Bytes are a plain `Uint8Array`, not the package's `Buffer`.
 */
export const readTextOrBytes: TypeCastFunction = (field) => {
  if (
    !TEXT_TYPES.has(field.type) ||
    (CHARACTER_OR_BLOB_TYPES.has(field.type) && field.collation.index === BINARY_COLLATION)
  ) {
    const bytes = field.buffer();
    return bytes === null ? null : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return field.string();
};
