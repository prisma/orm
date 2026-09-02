/**
 * Shared SQL utility functions for the Postgres target.
 *
 * These functions handle safe SQL identifier and literal escaping
 * with security validations to prevent injection and encoding issues.
 *
 * They live in `target-postgres` because both the control adapter (used at
 * emit time) and the runtime adapter (used at execute time) need the same
 * escaping/validation behavior, and the target package is the natural shared
 * home that both adapters can depend on without crossing planes.
 */

import { postgresError } from './errors';

const MAX_IDENTIFIER_LENGTH = 63;

const utf8 = new TextEncoder();

/**
 * UTF-8 byte length — the unit PostgreSQL measures identifiers and enum labels
 * in. `NAMEDATALEN - 1` is 63 *bytes*, so a name written in non-ASCII
 * characters can sit well under 63 characters and still overrun. Both length
 * checks in this module read through here so they cannot drift apart.
 */
function byteLength(value: string): number {
  return utf8.encode(value).length;
}

/**
 * Validates and quotes a PostgreSQL identifier (table, column, type, schema names).
 *
 * Security validations:
 * - Rejects null bytes which could cause truncation or unexpected behavior
 * - Rejects empty identifiers
 * - Warns on identifiers exceeding PostgreSQL's 63-byte limit
 *
 * @throws `CONTRACT.IDENTIFIER_INVALID` structured error If the identifier contains null bytes or is empty
 */
export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw postgresError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot be empty', {
      meta: { value: identifier, context: 'identifier' },
    });
  }
  if (identifier.includes('\0')) {
    throw postgresError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot contain null bytes', {
      meta: { value: identifier.replace(/\0/g, '\\0'), context: 'identifier' },
    });
  }
  if (byteLength(identifier) > MAX_IDENTIFIER_LENGTH) {
    console.warn(
      `Identifier "${identifier.slice(0, 20)}..." exceeds PostgreSQL's ${MAX_IDENTIFIER_LENGTH}-byte limit and will be truncated`,
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Escapes a string literal for safe use in SQL statements.
 *
 * Security validations:
 * - Rejects null bytes which could cause truncation or unexpected behavior
 *
 * Note: This assumes PostgreSQL's `standard_conforming_strings` is ON (default since PG 9.1).
 * Backslashes are treated as literal characters, not escape sequences.
 *
 * @throws `CONTRACT.IDENTIFIER_INVALID` structured error If the value contains null bytes
 */
export function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw postgresError('CONTRACT.IDENTIFIER_INVALID', 'Literal value cannot contain null bytes', {
      meta: { value: value.replace(/\0/g, '\\0'), context: 'literal' },
    });
  }
  return value.replace(/'/g, "''");
}

/**
 * Builds a qualified name (schema.object) with proper quoting.
 */
export function qualifyName(schemaName: string, objectName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}

/**
 * Quotes a possibly dot-qualified name segment-by-segment:
 * `order_status` -> `"order_status"`, `auth.aal_level` -> `"auth"."aal_level"`.
 * A single-segment name round-trips to exactly {@link quoteIdentifier}; whole-
 * string quoting (`"auth.aal_level"`) would be one wrong identifier.
 */
export function quoteQualifiedName(name: string): string {
  return name
    .split('.')
    .map((segment) => quoteIdentifier(segment))
    .join('.');
}

/**
 * Validates that an enum value doesn't exceed PostgreSQL's label length limit.
 *
 * PostgreSQL enum labels have a maximum length of NAMEDATALEN-1 (63 bytes by default).
 * Unlike identifiers, enum labels that exceed this limit cause an error rather than
 * silent truncation.
 *
 * @param value - The enum value to validate
 * @param enumTypeName - Name of the enum type (for error messages)
 * @throws `CONTRACT.IDENTIFIER_INVALID` structured error If the value exceeds the maximum length
 */
export function validateEnumValueLength(value: string, enumTypeName: string): void {
  if (byteLength(value) > MAX_IDENTIFIER_LENGTH) {
    throw postgresError(
      'CONTRACT.IDENTIFIER_INVALID',
      `Enum value "${value.slice(0, 20)}..." for type "${enumTypeName}" exceeds PostgreSQL's ` +
        `${MAX_IDENTIFIER_LENGTH}-byte label limit`,
      { meta: { value, context: 'enum-label' } },
    );
  }
}
