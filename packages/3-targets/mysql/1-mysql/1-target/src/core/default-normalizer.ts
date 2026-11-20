/**
 * Reading the default a MySQL column reports in `information_schema.COLUMNS`. MySQL 8 reports a literal default unquoted in `COLUMN_DEFAULT`, which is the text the driver hands `fromWire` for a row of the column, and marks an expression default with `DEFAULT_GENERATED` in `EXTRA`. An `auto_increment` column reports its numbering in `EXTRA` and no default.
 */

import type { ColumnDefault } from '@internal/contract/types';
import type { DefaultResolverColumn, ReportedLiteralDefault } from '@internal/family-sql/control';
import {
  MYSQL_DATE_NOW,
  MYSQL_INSTANT_NOW,
  MYSQL_TIME_NOW,
  mysqlCurrentValueFor,
} from './now-expression';

const AUTOINCREMENT = { kind: 'function', expression: 'autoincrement()' } as const;
const CURRENT_TIMESTAMP =
  /^(?:current_timestamp|now|localtime|localtimestamp)(?:\s*\(\s*\d*\s*\))?$/i;
const CURRENT_DATE = /^(?:curdate|current_date)(?:\s*\(\s*\))?$/i;
const CURRENT_TIME = /^(?:curtime|current_time)(?:\s*\(\s*\d*\s*\))?$/i;

/** The name of the current value `expression` writes: `now()` for the current instant, and its own name for the current date and the current time of day, which hold different values. `undefined` for any other expression. */
function currentValueNamed(expression: string): string | undefined {
  if (CURRENT_TIMESTAMP.test(expression)) return MYSQL_INSTANT_NOW;
  if (CURRENT_DATE.test(expression)) return MYSQL_DATE_NOW;
  if (CURRENT_TIME.test(expression)) return MYSQL_TIME_NOW;
  return undefined;
}

/** What a column's reported default is: a function, or a literal the column's codec reads. */
export type MysqlReportedDefault =
  | { readonly kind: 'function'; readonly expression: string }
  | {
      readonly kind: 'literal';
      readonly literal: Extract<ReportedLiteralDefault, { readonly kind: 'value' }> & {
        readonly body: string | Uint8Array;
      };
    };

const SQL_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
};

const INTRODUCED_STRING = /^_([A-Za-z0-9]+)'/;
const HEX_LITERAL = /^(?:0x((?:[0-9A-Fa-f]{2})*)|X'((?:[0-9A-Fa-f]{2})*)')$/;
const BLOB_COLUMN_TYPE = /^(?:tiny|medium|long)?blob$/i;
const BINARY_COLUMN_TYPE = /^(?:varbinary\(\d+\)|binary\((\d+)\))$/i;
const LATIN1_LAST = 0xff;

/** The character sets whose text is UTF-8, which is what a connection to MySQL or MariaDB sends; ASCII text is the same in UTF-8 and Latin-1. */
const UTF8_CHARACTER_SETS = new Set(['utf8mb4', 'utf8mb3', 'utf8', 'binary']);
const ASCII_CHARACTER_SETS = new Set(['ascii', 'latin1']);

/** Whether `columnType` is a blob, `binary` or `varbinary` column, whose rows the driver hands over as bytes. The driver hands `bit` and `geometry` columns over as bytes too; they are left out because no MySQL codec declares them. */
export function isMysqlBytesColumnType(columnType: string): boolean {
  return BLOB_COLUMN_TYPE.test(columnType) || BINARY_COLUMN_TYPE.test(columnType);
}

/** Whether `columnType` is a blob column, which MySQL gives an expression default only. */
export function isMysqlBlobColumnType(columnType: string): boolean {
  return BLOB_COLUMN_TYPE.test(columnType);
}

function withoutBackslashEscapes(text: string): string {
  return text.replace(/\\(.)/gs, '$1');
}

/** The text of a MySQL string literal whose opening quote ends `start`, when the literal runs to the end of `text`. */
function stringLiteralBody(text: string, start: number): string | undefined {
  let body = '';
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '\\') {
      index += 1;
      const escaped = text.charAt(index);
      body +=
        escaped === '%' || escaped === '_' ? `\\${escaped}` : (SQL_ESCAPES[escaped] ?? escaped);
    } else if (char === "'" && text.charAt(index + 1) === "'") {
      body += "'";
      index += 1;
    } else if (char === "'") {
      return index === text.length - 1 ? body : undefined;
    } else {
      body += char;
    }
  }
  return undefined;
}

function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The bytes of an expression default, which MySQL reports with each byte shown as the Latin-1 character of the same value: `_utf8mb4'é'` is reported `_utf8mb4\'Ã©\'`. Text with a character past Latin-1 is not in that form and is taken as written.
 */
function expressionBytes(reported: string): Uint8Array {
  const latin1 = [...reported].every((char) => (char.codePointAt(0) ?? 0) <= LATIN1_LAST);
  return Buffer.from(reported, latin1 ? 'latin1' : 'utf8');
}

/** One byte for each character of `bytes`, so a pattern can read the ASCII of an expression without decoding the rest. */
function asByteText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

type LiteralBody = string | Uint8Array;

/**
 * The value of a string literal with a character set introducer, such as `_utf8mb4'abc'`, the form MySQL reports a literal default on a text, blob or JSON column in: its bytes on a bytes column, and its text on any other. `undefined` for any other expression, and for a literal in a character set other than UTF-8, or Latin-1 and ASCII holding ASCII only, which the reader does not convert.
 */
function introducedStringValue(byteText: string, bytesColumn: boolean): LiteralBody | undefined {
  const expression = withoutBackslashEscapes(byteText.trim());
  const opening = INTRODUCED_STRING.exec(expression);
  if (opening === null) return undefined;
  const body = stringLiteralBody(expression, opening[0].length);
  if (body === undefined) return undefined;
  const bytes = Buffer.from(body, 'latin1');
  const characterSet = (opening[1] ?? '').toLowerCase();
  const ascii = bytes.every((byte) => byte < 0x80);
  if (
    !UTF8_CHARACTER_SETS.has(characterSet) &&
    !(ASCII_CHARACTER_SETS.has(characterSet) && ascii)
  ) {
    return undefined;
  }
  return bytesColumn ? new Uint8Array(bytes) : utf8Text(bytes);
}

function bytesOfHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function hexLiteralBytes(text: string): Uint8Array | undefined {
  const match = HEX_LITERAL.exec(text.trim());
  if (match === null) return undefined;
  return bytesOfHex(match[1] ?? match[2] ?? '');
}

/** The bytes a row of a `binary(n)` column holds for `bytes`: padded with zero bytes to its length, as the server pads every value. */
function paddedTo(columnType: string, bytes: Uint8Array): Uint8Array {
  const length = Number(BINARY_COLUMN_TYPE.exec(columnType)?.[1] ?? 0);
  if (bytes.length >= length) return bytes;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  return padded;
}

function extraFlags(extra: string): readonly string[] {
  return extra.toLowerCase().split(/\s+/);
}

function literal(body: LiteralBody): MysqlReportedDefault {
  return { kind: 'literal', literal: { kind: 'value', body } };
}

function expressionDefault(reported: string, bytesColumn: boolean): MysqlReportedDefault {
  const bytes = expressionBytes(reported);
  const byteText = asByteText(bytes);
  const introduced = introducedStringValue(byteText, bytesColumn);
  if (introduced !== undefined) return literal(introduced);
  const hex = hexLiteralBytes(withoutBackslashEscapes(byteText));
  if (hex !== undefined) return literal(hex);
  const expression = (utf8Text(bytes) ?? reported).trim();
  return { kind: 'function', expression: currentValueNamed(expression) ?? expression };
}

/** A literal default on a `binary` or `varbinary` column is kept as reported, since the report may not be the row's bytes: MySQL cuts it at its first zero byte, and MariaDB shows each byte that is not UTF-8 as `?`. */
function literalDefault(reported: string, bytesColumn: boolean): MysqlReportedDefault {
  return bytesColumn ? { kind: 'function', expression: reported } : literal(reported);
}

/**
 * Reads a column's reported default from `COLUMN_DEFAULT` and `EXTRA`, as what a row of the column hands its codec. `auto_increment` is `autoincrement()`. An expression default (`DEFAULT_GENERATED`) is a literal when it is a string with a character set introducer, such as `_utf8mb4\'abc\'`, the form MySQL reports for a literal default on a text, blob or JSON column, or a hexadecimal literal, `0x00ff`, or `X\'\'` for no bytes, the forms it reports for bytes; one that writes the current instant, such as `CURRENT_TIMESTAMP(3)`, is `now()`, and one that writes the current date or time of day, `curdate()` or `curtime(6)`, is `CURRENT_DATE` or `CURRENT_TIME`; any other is a function default kept as reported. On a bytes column, `columnType` a blob, `binary` or `varbinary`, a literal is the bytes the server stores: the bytes of a hexadecimal literal, and the UTF-8 bytes of text, padded to the length of a `binary(n)`. Any other default is a literal, except one on a `binary` or `varbinary` column, which is kept as reported because the report may not be the row's bytes. `undefined` when the column has no default.
 */
export function readMysqlDefault(
  columnDefault: string | null,
  extra: string,
  columnType: string,
): MysqlReportedDefault | undefined {
  const flags = extraFlags(extra);
  if (flags.includes('auto_increment')) return AUTOINCREMENT;
  if (columnDefault === null) return undefined;
  const bytesColumn = isMysqlBytesColumnType(columnType);
  const read = flags.includes('default_generated')
    ? expressionDefault(columnDefault, bytesColumn)
    : literalDefault(columnDefault, bytesColumn);
  if (read.kind === 'literal' && read.literal.body instanceof Uint8Array && bytesColumn) {
    return literal(paddedTo(columnType, read.literal.body));
  }
  return read;
}

/**
 * Names a contract's expression default the way {@link readMysqlDefault} names the same function in the database, so `` sql`CURRENT_TIMESTAMP(3)` `` and the database's `now()` compare equal. A `now()` default is named as the current value its column's data type writes, so a `now()` on a `date` column and one on a `datetime` column differ, as the values they write do. Every other default passes through unchanged.
 */
export function mysqlResolveDefault(
  def: ColumnDefault,
  column: DefaultResolverColumn,
): ColumnDefault {
  if (def.kind !== 'function') return def;
  const expression = def.expression.trim();
  const named =
    expression === MYSQL_INSTANT_NOW
      ? mysqlCurrentValueFor(column.dataTypeId)
      : currentValueNamed(expression);
  return named === undefined ? def : { kind: 'function', expression: named };
}
