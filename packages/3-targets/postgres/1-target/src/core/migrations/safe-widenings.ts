import type { DataTypeParams } from '@internal/framework-components/codec';
import type { SqlColumnIR, SqlColumnType } from '@internal/sql-schema-ir/types';
import {
  pgFloat4,
  pgFloat8,
  pgInt2,
  pgInt4,
  pgInt8,
  pgNumeric,
  pgText,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgVarbit,
  pgVarchar,
} from '../data-types';

/** The changes between data types that keep every value: each pair is `from→to` by data type id. */
const SAFE_WIDENINGS = new Set([
  `${pgInt2.id}→${pgInt4.id}`,
  `${pgInt2.id}→${pgInt8.id}`,
  `${pgInt4.id}→${pgInt8.id}`,
  `${pgInt2.id}→${pgFloat4.id}`,
  `${pgInt2.id}→${pgFloat8.id}`,
  `${pgInt4.id}→${pgFloat8.id}`,
  `${pgFloat4.id}→${pgFloat8.id}`,
  `${pgVarchar.id}→${pgText.id}`,
  `${pgInt2.id}→${pgText.id}`,
  `${pgInt4.id}→${pgText.id}`,
  `${pgInt8.id}→${pgText.id}`,
  `${pgNumeric.id}→${pgText.id}`,
  `${pgFloat4.id}→${pgText.id}`,
  `${pgFloat8.id}→${pgText.id}`,
]);

/** Types whose `length` caps their values; a larger cap, or none, keeps every value. */
const LENGTH_CAPPED = new Set<string>([pgVarchar.id, pgVarbit.id]);

/** Types whose `precision` rounds their fractional seconds; more, or none, keeps every value. */
const PRECISION_ROUNDED = new Set<string>([
  pgTime.id,
  pgTimetz.id,
  pgTimestamp.id,
  pgTimestamptz.id,
]);

function numberParam(params: DataTypeParams, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

/** Whether a cap, where `undefined` means none, is at least as large as before. */
function capGrows(from: number | undefined, to: number | undefined): boolean {
  return to === undefined || (from !== undefined && to >= from);
}

/**
 * A `numeric` keeps every value when it allows at least as many digits before the point and after
 * it; an unconstrained `numeric` holds any value.
 */
function numericGrows(from: DataTypeParams, to: DataTypeParams): boolean {
  const toPrecision = numberParam(to, 'precision');
  if (toPrecision === undefined) return true;
  const fromPrecision = numberParam(from, 'precision');
  if (fromPrecision === undefined) return false;
  const fromScale = numberParam(from, 'scale') ?? 0;
  const toScale = numberParam(to, 'scale') ?? 0;
  return toScale >= fromScale && toPrecision - toScale >= fromPrecision - fromScale;
}

/** Whether changing a column from one type to another keeps every value: both have a stored type, and the pair is a safe widening by stored type id and parameters in normal form. */
export function isSafeTypeWidening(from: SqlColumnType, to: SqlColumnType): boolean {
  if (from.storedType === undefined || to.storedType === undefined) return false;
  const fromId = from.storedType.id;
  const toId = to.storedType.id;
  const fromParams = from.storedTypeParams ?? {};
  const toParams = to.storedTypeParams ?? {};
  if (SAFE_WIDENINGS.has(`${fromId}→${toId}`)) return true;
  if (fromId !== toId) return false;
  if (LENGTH_CAPPED.has(fromId)) {
    return capGrows(numberParam(fromParams, 'length'), numberParam(toParams, 'length'));
  }
  if (PRECISION_ROUNDED.has(fromId)) {
    return capGrows(numberParam(fromParams, 'precision'), numberParam(toParams, 'precision'));
  }
  if (fromId === pgNumeric.id) return numericGrows(fromParams, toParams);
  return false;
}

/** Whether changing a live column to the contract's column keeps every value. A list column never widens safely. */
export function liveColumnWidensSafely(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.many === true || actual.many === true) return false;
  return isSafeTypeWidening(actual, expected);
}
