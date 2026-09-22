/**
 * Normalizes SQLite's stored default expressions back into the
 * `ColumnDefault` shape the verifier compares against. Lives target-side
 * (mirroring Postgres's `target-postgres/src/core/default-normalizer.ts`)
 * so both the control adapter (`SqliteControlAdapter.introspect`) and the
 * planner / runner schema-verify path can consume it without
 * `target-sqlite` reaching into `adapter-sqlite`.
 */

import type { ColumnDefault } from '@internal/contract/types';

const NULL_PATTERN = /^NULL$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const REAL_PATTERN = /^-?\d+\.\d+(?:[eE][+-]?\d+)?$/;
const HEX_PATTERN = /^0[xX][\dA-Fa-f]+$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;

function isNumericLiteral(value: string): boolean {
  return INTEGER_PATTERN.test(value) || REAL_PATTERN.test(value) || HEX_PATTERN.test(value);
}

/**
 * Strips a single matched wrapping pair of outer parens from `s`. Conservative:
 * only strips when the leading `(` is matched by the trailing `)` (so
 * `(a) + (b)` is returned unchanged). Mirrors SQLite's own
 * `pragma_table_info.dflt_value` normalization for expression defaults, and
 * is shared with the recreate-table postcheck builder so both sides agree
 * on the canonical form.
 */
export function stripOuterParens(s: string): string {
  if (!s.startsWith('(') || !s.endsWith(')')) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0 && i < s.length - 1) return s;
    }
  }
  return s.slice(1, -1);
}

export function parseSqliteDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  let trimmed = rawDefault.trim();

  // Strip outer parentheses that SQLite adds around expressions. Iterate to
  // fixpoint so accidental double-wrapping (e.g. `((expr))`) collapses too.
  while (true) {
    const stripped = stripOuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
  }

  // SQLite has several spellings for "current timestamp" — `CURRENT_TIMESTAMP`
  // (keyword) and `datetime('now')` / `datetime("now")` (function call). The
  // contract authoring side canonicalizes `dbgenerated("CURRENT_TIMESTAMP")`
  // (and friends) to `now()` via `lowerDbgenerated`; mirror that here so a
  // schema produced by either spelling round-trips to the same canonical
  // form for verification.
  const lower = trimmed.toLowerCase();
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return { kind: 'function', expression: 'now()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  // SQLite integers are 64-bit, so values outside the JS safe-integer range can't
  // be faithfully represented as `number`. Mirror `parsePostgresDefault`'s bigint
  // handling: parse as JS `number` when safe, fall back to the raw text otherwise.
  if (isNumericLiteral(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    if (nativeType?.toLowerCase() === 'integer' && !Number.isSafeInteger(num)) {
      return { kind: 'literal', value: trimmed };
    }
    return { kind: 'literal', value: num };
  }

  const stringMatch = trimmed.match(STRING_LITERAL_PATTERN);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    return { kind: 'literal', value: unescaped };
  }

  // Unrecognized expression — preserve as function
  return { kind: 'function', expression: trimmed };
}

/**
 * The contract-derived side of verify: an authored function default is read
 * through the same parser as an introspected one, so `` sql`CURRENT_TIMESTAMP` ``
 * and the database's `CURRENT_TIMESTAMP` compare equal. Mirrors Postgres's
 * `postgresResolveDefault`.
 */
export function sqliteResolveDefault(
  def: ColumnDefault,
  resolvedNativeType: string,
): ColumnDefault {
  if (def.kind !== 'function') {
    return def;
  }
  return parseSqliteDefault(def.expression, resolvedNativeType) ?? def;
}
