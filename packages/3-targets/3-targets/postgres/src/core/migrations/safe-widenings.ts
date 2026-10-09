import { type SqlTypeLookups, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import type { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
import { pgFloat4, pgFloat8, pgInt2, pgInt4, pgInt8 } from '../data-types';

/** The type changes that keep every value: each pair is `from→to` by data type id. */
const SAFE_WIDENINGS = new Set([
  `${pgInt2.id}→${pgInt4.id}`,
  `${pgInt2.id}→${pgInt8.id}`,
  `${pgInt4.id}→${pgInt8.id}`,
  `${pgFloat4.id}→${pgFloat8.id}`,
]);

const WIDENABLE_TYPES = [pgInt2, pgInt4, pgInt8, pgFloat4, pgFloat8];

export function isSafeTypeWidening(fromDataType: string, toDataType: string): boolean {
  return SAFE_WIDENINGS.has(`${fromDataType}→${toDataType}`);
}

/** The id of the data type a column node's codec represents. */
export function columnDataType(column: SqlColumnIR, types: SqlTypeLookups): string {
  if (column.codecRef === undefined) {
    throw new InternalError(
      `Column "${column.name}" carries no codec, so its data type is unknown; a type change is planned only between columns built from contracts.`,
    );
  }
  return sqlDataTypeOfCodec(column.codecRef.codecId, types).id;
}

/** The widenable data type a migration writes as `text`, which introspection reports normalised. */
function widenableDataTypeWritten(text: string): string | undefined {
  return WIDENABLE_TYPES.find((type) =>
    type.sql.texts.some((candidate) => candidate.written === true && candidate.text === text),
  )?.id;
}

/**
 * Whether changing an introspected column to the contract's column keeps every value. The live
 * column carries no codec, so its type is read from the normalised name introspection reports.
 */
export function liveColumnWidensSafely(
  expected: SqlColumnIR,
  actual: SqlColumnIR,
  types: SqlTypeLookups,
): boolean {
  if (expected.many === true || actual.many === true) return false;
  const from =
    actual.resolvedNativeType === undefined
      ? undefined
      : widenableDataTypeWritten(actual.resolvedNativeType);
  return from !== undefined && isSafeTypeWidening(from, columnDataType(expected, types));
}
