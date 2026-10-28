import { type MysqlPlaceholderToken, tokenizeMysqlSql } from '@internal/target-mysql/sql-utils';
import { structuredError } from '@internal/utils/structured-error';

function placeholderMismatch(placeholders: readonly string[], values: number): Error {
  return structuredError(
    'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
    `The MySQL statement writes placeholders ${JSON.stringify(placeholders)} for ${values} parameter value(s); write each value as a numbered ?N, or every value as a bare ? in order, and no other placeholder.`,
    {
      why: 'A placeholder that does not match a value binds a value to the wrong place in the statement, or leaves a value unbound.',
      fix: 'Pass values into raw SQL through interpolation rather than writing a `?` in the SQL text.',
      meta: { placeholders, params: values },
    },
  );
}

/** The index into `values` each placeholder takes: `?N` takes value N, and bare `?`s take the values in order. */
export function valueIndexes(
  placeholders: readonly MysqlPlaceholderToken[],
  values: number,
): number[] {
  const texts = placeholders.map((placeholder) => placeholder.text);
  if (texts.every((text) => text === '?')) {
    if (placeholders.length !== values) throw placeholderMismatch(texts, values);
    return placeholders.map((_, index) => index);
  }
  const indexes = placeholders.map((placeholder) => (placeholder.number ?? 0) - 1);
  const valid =
    indexes.every((index) => index >= 0 && index < values) && new Set(indexes).size === values;
  if (!valid) throw placeholderMismatch(texts, values);
  return indexes;
}

function unsupportedValue(message: string, meta: Record<string, unknown>): Error {
  return structuredError('RUNTIME.AST_INVALID', message, { meta: { target: 'mysql', ...meta } });
}

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

function int64(value: bigint, index: number): bigint {
  if (value < BIGINT_MIN || value > BIGINT_MAX) {
    throw unsupportedValue(
      `MySQL has no parameter value for the integer ${value}; a parameter integer must fit in a signed 64-bit BIGINT`,
      { index },
    );
  }
  return value;
}

/**
 * The value the `mariadb` package sends for a parameter. Every integer goes as a 64-bit BIGINT: the package sends a number as INT only below 2^31 - 1 and otherwise as DOUBLE, which MySQL refuses in `LIMIT`. A bigint outside the signed 64-bit range is refused here, because the package crashes the process on one. A `Uint8Array` goes as a Buffer over the same bytes, because the package sends any other `Uint8Array` as JSON text. A `Date` is refused: the package encodes it in the process's local time zone, and the MySQL codecs send dates as text.
 */
function bindValue(value: unknown, index: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unsupportedValue(`MySQL has no parameter value for ${value}`, { index });
    }
    return Number.isInteger(value) ? int64(BigInt(value), index) : value;
  }
  if (typeof value === 'bigint') return int64(value, index);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  throw unsupportedValue(
    'A MySQL parameter must be text, a number, a bigint, a boolean, bytes or null; a Date is sent as text by its codec',
    {
      index,
      valueType: value instanceof Date ? 'Date' : Array.isArray(value) ? 'array' : typeof value,
    },
  );
}

/**
 * The statement with each placeholder written as MySQL's positional `?`, and its values in that order. The adapter writes numbered `?N` placeholders, a value written as often as its `?N` appears; the control plane writes bare `?`s, which take the values in order. `tokenizeMysqlSql` reads the statement as MySQL's lexer does, so a `?` inside a quoted string, a backtick identifier or a comment stays text. Refuses a statement that mixes the two forms, or whose placeholders and values do not match.
 */
export function positionalParams(
  sql: string,
  values: readonly unknown[],
): { readonly sql: string; readonly values: unknown[] } {
  const tokens = tokenizeMysqlSql(sql);
  const placeholders = tokens.filter(
    (token): token is MysqlPlaceholderToken => token.kind === 'placeholder',
  );
  const indexes = valueIndexes(placeholders, values.length);
  return {
    sql: tokens.map((token) => (token.kind === 'placeholder' ? '?' : token.text)).join(''),
    values: indexes.map((index) => bindValue(values[index], index)),
  };
}
