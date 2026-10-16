/**
 * Reading the default a SQLite column reports (`pragma_table_info.dflt_value`): a recognized function, SQL NULL, or a literal whose body this module takes out of the quotes and parentheses. The body is what the driver hands `fromWire` for a row of the column, decided by the column's type affinity, and the column's codec reads it (ADR 254); nothing here knows a data type.
 */

import type { ColumnDefault } from '@internal/contract/types';
import type { ReportedBody, ReportedLiteralDefault } from '@internal/family-sql/control';
import { SQLITE_DATETIME_TEXT_FORMAT } from './datetime-text';

const NULL_PATTERN = /^NULL$/i;
const INTEGER_PATTERN = /^[+-]?\d+$/;
const REAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const STRING_LITERAL_PATTERN = /^'((?:[^']|'')*)'$/;
const STRFTIME_NOW_PATTERN = /^strftime\s*\(\s*(['"])([^'"]*)\1\s*,\s*(['"])now\3\s*\)$/i;

function isCurrentTimestamp(expression: string): boolean {
  const lower = expression.toLowerCase();
  if (lower === 'current_timestamp' || lower === "datetime('now')" || lower === 'datetime("now")') {
    return true;
  }
  return expression.match(STRFTIME_NOW_PATTERN)?.[2] === SQLITE_DATETIME_TEXT_FORMAT;
}

/**
 * Strips a single matched wrapping pair of outer parens from `s`. Conservative:
 * only strips when the leading `(` is matched by the trailing `)` (so
 * `(a) + (b)` is returned unchanged). Mirrors SQLite's own
 * `pragma_table_info.dflt_value` normalization for expression defaults, and
 * is shared with the recreate-table postcheck builder so both sides agree
 * on the text.
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

type Affinity = 'integer' | 'text' | 'blob' | 'real' | 'numeric';

/** The type affinity SQLite gives a column of `declaredType`, by its rules in order. */
function affinityOf(declaredType: string): Affinity {
  const upper = declaredType.toUpperCase();
  if (upper.includes('INT')) return 'integer';
  if (upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('TEXT')) return 'text';
  if (upper.includes('BLOB') || upper.trim() === '') return 'blob';
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'real';
  return 'numeric';
}

/** A numeral as the driver returns it: a number, or digit text for an integer no double holds exactly. */
function numberBody(numeral: string): ReportedBody {
  if (INTEGER_PATTERN.test(numeral)) {
    const integer = BigInt(numeral);
    return Number.isSafeInteger(Number(integer)) ? Number(integer) : integer.toString();
  }
  return Number(numeral);
}

/** What the column stores for a literal written as `text` (quoted) or as a numeral, by its affinity. */
function bodyFor(literal: string, quoted: boolean, affinity: Affinity): ReportedBody {
  const numeral = INTEGER_PATTERN.test(literal) || REAL_PATTERN.test(literal);
  if (affinity === 'text') return literal;
  if (affinity === 'blob') return quoted || !numeral ? literal : numberBody(literal);
  return numeral ? numberBody(literal) : literal;
}

/** A blob literal: `X'` or `x'`, an even number of hexadecimal digits, `'`. */
const BLOB_LITERAL_PATTERN = /^[xX]'((?:[0-9a-fA-F]{2})*)'$/;

/** What a column's reported default is: a function, SQL NULL, or a literal the column's codec reads. */
export type SqliteReportedDefault =
  | { readonly kind: 'function'; readonly expression: string }
  | { readonly kind: 'null' }
  | { readonly kind: 'literal'; readonly literal: ReportedLiteralDefault };

/**
 * Reads a column's reported default. `CURRENT_TIMESTAMP`, `datetime('now')` and the expression a `now()` default is written as are `now()`. A quoted string, a numeral or a blob literal (`X'6869'`, read as its bytes) is a literal; any other expression is a function default, kept as reported.
 */
export function readSqliteDefault(rawDefault: string, declaredType: string): SqliteReportedDefault {
  let trimmed = rawDefault.trim();
  while (true) {
    const stripped = stripOuterParens(trimmed).trim();
    if (stripped === trimmed) break;
    trimmed = stripped;
  }
  if (isCurrentTimestamp(trimmed)) return { kind: 'function', expression: 'now()' };
  if (NULL_PATTERN.test(trimmed)) return { kind: 'null' };
  const affinity = affinityOf(declaredType);
  const quoted = STRING_LITERAL_PATTERN.exec(trimmed)?.[1];
  if (quoted !== undefined) {
    const text = quoted.replace(/''/g, "'");
    return { kind: 'literal', literal: { kind: 'value', body: bodyFor(text, true, affinity) } };
  }
  const blobHex = BLOB_LITERAL_PATTERN.exec(trimmed)?.[1];
  if (blobHex !== undefined) {
    return {
      kind: 'literal',
      literal: { kind: 'value', body: new Uint8Array(Buffer.from(blobHex, 'hex')) },
    };
  }
  if (INTEGER_PATTERN.test(trimmed) || REAL_PATTERN.test(trimmed)) {
    return { kind: 'literal', literal: { kind: 'value', body: bodyFor(trimmed, false, affinity) } };
  }
  return { kind: 'function', expression: trimmed };
}

/**
 * Names a contract's expression default the way {@link readSqliteDefault} names the same function in the database, so `` sql`CURRENT_TIMESTAMP` `` and the database's `datetime('now')` compare equal. A literal default, and an expression that writes a literal, pass through unchanged; introspection reads the latter's literal with the column's codec, and the diff compares the values.
 */
export function sqliteResolveDefault(def: ColumnDefault, declaredType: string): ColumnDefault {
  if (def.kind !== 'function') return def;
  const read = readSqliteDefault(def.expression, declaredType);
  return read.kind === 'function' ? read : def;
}
