import { createHash } from 'node:crypto';

const STRING_LITERAL_REGEX = /'(?:''|[^'])*'/g;
const NUMERIC_LITERAL_REGEX = /\b\d+(?:\.\d+)?\b/g;
const WHITESPACE_REGEX = /\s+/g;

/**
 * Computes a literal-stripped, normalized fingerprint of a SQL statement.
 *
 * The function strips string and numeric literals, collapses whitespace, and
 * lowercases the result before hashing — so two structurally equivalent
 * statements (with different parameter values) produce the same fingerprint.
 * Used by SQL telemetry to group queries.
 */
export function computeSqlFingerprint(sql: string): string {
  const withoutStrings = sql.replace(STRING_LITERAL_REGEX, '?');
  const withoutNumbers = withoutStrings.replace(NUMERIC_LITERAL_REGEX, '?');
  const normalized = withoutNumbers.replace(WHITESPACE_REGEX, ' ').trim().toLowerCase();

  return createHash('sha256').update(normalized).digest('hex');
}
