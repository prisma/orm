import { mysqlError } from './errors';

/** A MySQL identifier in backticks, with each backtick doubled. */
export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw mysqlError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot be empty', {
      meta: { value: identifier, context: 'identifier' },
    });
  }
  if (identifier.includes('\0')) {
    throw mysqlError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot contain null bytes', {
      meta: { value: identifier.replace(/\0/g, '\\0'), context: 'identifier' },
    });
  }
  return `\`${identifier.replace(/`/g, '``')}\``;
}

/** The body of a MySQL string literal: quotes doubled and backslashes escaped, as MySQL reads them under its default SQL mode. */
export function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw mysqlError('CONTRACT.IDENTIFIER_INVALID', 'Literal value cannot contain null bytes', {
      meta: { value: value.replace(/\0/g, '\\0'), context: 'literal' },
    });
  }
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/** A MySQL string literal. */
export function quoteLiteral(value: string): string {
  return `'${escapeLiteral(value)}'`;
}
