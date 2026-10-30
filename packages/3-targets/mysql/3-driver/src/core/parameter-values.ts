import { mysqlError } from '@internal/target-mysql/errors';

function unsendable(message: string, paramIndex: number, received: string): Error {
  return mysqlError('RUNTIME.ENCODE_FAILED', message, {
    meta: { target: 'mysql', paramIndex, received },
  });
}

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;

const LONE_SURROGATE = /\p{Surrogate}/u;

function withinBigint(value: bigint): boolean {
  return value >= BIGINT_MIN && value <= BIGINT_MAX;
}

function receivedKind(value: unknown): string {
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * The value the `mariadb` package writes into the statement for a parameter. A finite number or a bigint goes as it is, and the package writes its digits. A non-finite number is refused, because the package would write `NaN` or `Infinity` into the SQL. A bigint must fit a signed BIGINT, so a parameter's type never depends on its value. A `Uint8Array` goes as a Buffer over the same bytes, because the package writes any other `Uint8Array` as JSON text. A `Date` is refused: the package writes it in the process's local time zone, and the MySQL codecs send dates as text. So is text with a lone UTF-16 surrogate, which the package writes as `?` or U+FFFD depending on the text's length.
 */
export function bindValue(value: unknown, index: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw unsendable(
        `Parameter ${index + 1} is ${value}, which MySQL cannot store`,
        index,
        String(value),
      );
    }
    return value;
  }
  if (typeof value === 'bigint') {
    if (withinBigint(value)) return value;
    throw unsendable(
      `Parameter ${index + 1} is an integer outside MySQL's signed 64-bit BIGINT`,
      index,
      'bigint',
    );
  }
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') {
    if (!LONE_SURROGATE.test(value)) return value;
    throw unsendable(
      `Parameter ${index + 1} is text with a lone UTF-16 surrogate, which is not a character and has no utf8mb4 form; the mariadb package would store it as ? or as U+FFFD, depending on the length of the text`,
      index,
      'string',
    );
  }
  if (typeof value === 'boolean') return value;
  const received = receivedKind(value);
  throw unsendable(
    `Parameter ${index + 1} is of type ${received}; a MySQL parameter must be text, a number, a bigint, a boolean, bytes or null, and a Date is sent as text by its codec`,
    index,
    received,
  );
}
