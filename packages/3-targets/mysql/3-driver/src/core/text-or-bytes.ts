import type { FieldInfo, TypeCastFunction } from 'mariadb';
import { mysqlDoubleText, mysqlFixedDecimalsText, mysqlFloatText } from './float-text';

/** MySQL's `binary` collation, which marks a string or blob column that holds bytes. */
const BINARY_COLLATION = 63;

/** The decimals MySQL reports for a FLOAT or DOUBLE column declared without them. */
const NOT_FIXED_DECIMALS = 31;

/** The column flag MySQL sets on a `ZEROFILL` number and on `YEAR`, whose text it pads with zeros to the column's width. */
const ZEROFILL = 1 << 6;

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

/** The column types besides FLOAT and DOUBLE whose value MySQL sends as text. A type outside this list, such as BIT, GEOMETRY or one the package has no name for, is read as bytes. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  ...CHARACTER_OR_BLOB_TYPES,
  'DECIMAL',
  'NEWDECIMAL',
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

/** The most fraction digits a MySQL time can have; a computed column of unknown precision reports more. */
const MAX_FRACTION_DIGITS = 6;

function withFractionDigits(time: string, digits: number): string {
  if (digits > MAX_FRACTION_DIGITS) return time;
  const [whole = '', fraction = ''] = time.split('.');
  return digits === 0 ? whole : `${whole}.${fraction.padEnd(digits, '0').slice(0, digits)}`;
}

/**
 * The column's text in one form whichever protocol carried it. Over the text protocol MySQL writes it; under a prepared statement MySQL sends numbers, dates and times in binary and the package writes them. They differ for three kinds of column besides FLOAT and DOUBLE, so each gets MySQL's form: YEAR and a ZEROFILL integer padded to the column's width, and a TIME with the column's fraction digits.
 */
function sameTextEitherProtocol(field: FieldInfo, text: string): string {
  switch (field.type) {
    case 'TIME':
      return withFractionDigits(text, field.scale);
    default:
      return (field.flags & ZEROFILL) === 0 ? text : text.padStart(field.columnLength, '0');
  }
}

/**
 * A FLOAT or DOUBLE as MySQL writes it over the text protocol, with the column's declared decimals if it has them. The package reads the number the server sent, whichever the protocol; the text it writes for a prepared statement's binary number differs from MySQL's in digits, notation and the sign of zero.
 */
function floatingText(field: FieldInfo): string | null {
  const value = field.float();
  if (value === null) return null;
  if (field.scale < NOT_FIXED_DECIMALS) return mysqlFixedDecimalsText(value, field.scale);
  return field.type === 'FLOAT' ? mysqlFloatText(value) : mysqlDoubleText(value);
}

/**
 * Reads each column as the row value ADR 155 sets at the driver boundary: a binary string or blob, BIT, GEOMETRY and a column of a type the package does not know as its bytes, every other column as text, and NULL as `null`. Bytes are a plain `Uint8Array`, not the package's `Buffer`.
 */
export const readTextOrBytes: TypeCastFunction = (field) => {
  if (field.type === 'FLOAT' || field.type === 'DOUBLE') return floatingText(field);
  if (
    !TEXT_TYPES.has(field.type) ||
    (CHARACTER_OR_BLOB_TYPES.has(field.type) && field.collation.index === BINARY_COLLATION)
  ) {
    const bytes = field.buffer();
    return bytes === null ? null : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const text = field.string();
  return text === null ? null : sameTextEitherProtocol(field, text);
};
