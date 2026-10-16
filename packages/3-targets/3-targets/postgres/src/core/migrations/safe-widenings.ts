import { dataTypeParams } from '@internal/framework-components/codec';
import {
  resolveWrittenSqlTypes,
  type SqlTypeLookups,
  type SqlTypeParams,
  sqlDataTypeOfCodec,
} from '@internal/sql-contract/data-type';
import type { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
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
  postgresDataTypes,
} from '../data-types';

/** A column's data type and its parameters in normal form. */
export interface ColumnType {
  readonly dataType: string;
  readonly params: SqlTypeParams;
}

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

function numberParam(params: SqlTypeParams, key: string): number | undefined {
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
function numericGrows(from: SqlTypeParams, to: SqlTypeParams): boolean {
  const toPrecision = numberParam(to, 'precision');
  if (toPrecision === undefined) return true;
  const fromPrecision = numberParam(from, 'precision');
  if (fromPrecision === undefined) return false;
  const fromScale = numberParam(from, 'scale') ?? 0;
  const toScale = numberParam(to, 'scale') ?? 0;
  return toScale >= fromScale && toPrecision - toScale >= fromPrecision - fromScale;
}

/** Whether changing a column from one type to another keeps every value. */
export function isSafeTypeWidening(from: ColumnType, to: ColumnType): boolean {
  if (SAFE_WIDENINGS.has(`${from.dataType}→${to.dataType}`)) return true;
  if (from.dataType !== to.dataType) return false;
  if (LENGTH_CAPPED.has(from.dataType)) {
    return capGrows(numberParam(from.params, 'length'), numberParam(to.params, 'length'));
  }
  if (PRECISION_ROUNDED.has(from.dataType)) {
    return capGrows(numberParam(from.params, 'precision'), numberParam(to.params, 'precision'));
  }
  if (from.dataType === pgNumeric.id) return numericGrows(from.params, to.params);
  return false;
}

function isParamRecord(value: unknown): value is SqlTypeParams {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The data type a column node's codec represents, with its parameters. */
export function columnType(column: SqlColumnIR, types: SqlTypeLookups): ColumnType {
  if (column.codecRef === undefined) {
    throw new InternalError(
      `Column "${column.name}" carries no codec, so its data type is unknown; a type change is planned only between columns built from contracts.`,
    );
  }
  const type = sqlDataTypeOfCodec(column.codecRef.codecId, types);
  const typeParams = column.codecRef.typeParams;
  const params = isParamRecord(typeParams) ? dataTypeParams(type, typeParams) : {};
  return { dataType: type.id, params: type.sql.normalize(params) };
}

/** The type of an introspected column, read from the type name introspection reports. */
function introspectedColumnType(column: SqlColumnIR): ColumnType | undefined {
  if (column.resolvedNativeType === undefined) return undefined;
  const [only, ...others] = resolveWrittenSqlTypes(column.resolvedNativeType, postgresDataTypes);
  return only === undefined || others.length > 0
    ? undefined
    : { dataType: only.dataType, params: only.typeParams };
}

/**
 * Whether changing a live column to the contract's column keeps every value. A column introspected
 * from the database carries no codec, so its type is read from the name introspection reports.
 */
export function liveColumnWidensSafely(
  expected: SqlColumnIR,
  actual: SqlColumnIR,
  types: SqlTypeLookups,
): boolean {
  if (expected.many === true || actual.many === true) return false;
  const from =
    actual.codecRef === undefined ? introspectedColumnType(actual) : columnType(actual, types);
  return from !== undefined && isSafeTypeWidening(from, columnType(expected, types));
}
