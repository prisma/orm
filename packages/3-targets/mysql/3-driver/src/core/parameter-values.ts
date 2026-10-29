import { mysqlError } from '@internal/target-mysql/errors';

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
    if (!Number.isInteger(value)) return value;
    const integer = BigInt(value);
    return withinBigint(integer) ? integer : value;
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
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  const received = receivedKind(value);
  throw unsendable(
    `Parameter ${index + 1} is of type ${received}; a MySQL parameter must be text, a number, a bigint, a boolean, bytes or null, and a Date is sent as text by its codec`,
    index,
    received,
  );
}
