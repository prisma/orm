import { mysqlError } from '@internal/target-mysql/errors';
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

function unsendable(message: string, paramIndex: number, received: string): Error {
  return mysqlError('RUNTIME.ENCODE_FAILED', message, {
    meta: { target: 'mysql', paramIndex, received },
  });
}

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

function withinBigint(value: bigint): boolean {
  return value >= BIGINT_MIN && value <= BIGINT_MAX;
}

function receivedKind(value: unknown): string {
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * The value the `mariadb` package sends for a parameter. An integer number within the signed 64-bit range goes as a BIGINT, because the package sends a number as INT only below 2^31 - 1 and otherwise as DOUBLE, which MySQL refuses in `LIMIT`; any other finite number goes as the DOUBLE it is. A bigint must fit a signed BIGINT: the package crashes the process on one below -2^63, and sends one at or above 2^63 as DECIMAL text, so the parameter's type would depend on its value. A `Uint8Array` goes as a Buffer over the same bytes, because the package sends any other `Uint8Array` as JSON text. A `Date` is refused: the package encodes it in the process's local time zone, and the MySQL codecs send dates as text.
 */
function bindValue(value: unknown, index: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unsendable(
        `Parameter ${index + 1} is ${value}, which MySQL cannot store`,
        index,
        String(value),
      );
    }
    if (!Number.isInteger(value)) return value;
    const integer = BigInt(value);
    return withinBigint(integer) ? integer : value;
  }
  if (typeof value === 'bigint') {
    if (withinBigint(value)) return value;
    throw unsendable(
      `Parameter ${index + 1} is the integer ${value}, outside MySQL's signed 64-bit BIGINT`,
      index,
      'bigint',
    );
  }
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  const received = receivedKind(value);
  throw unsendable(
    `Parameter ${index + 1} is of type ${received}; a MySQL parameter must be text, a number, a bigint, a boolean, bytes or null, and a Date is sent as text by its codec`,
    index,
    received,
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
