import type { CodecControlHooks } from '@internal/family-sql/control';
import { type SqlTypeLookups, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import {
  pgBit,
  pgBool,
  pgBytea,
  pgChar,
  pgDate,
  pgFloat4,
  pgFloat8,
  pgInt2,
  pgInt4,
  pgInt8,
  pgInterval,
  pgJson,
  pgJsonb,
  pgNumeric,
  pgText,
  pgTextArray,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgUuid,
  pgVarbit,
  pgVarchar,
} from '../data-types';

/**
 * Resolves the identity value (monoid neutral element) as a SQL literal for a column's type.
 * Checks codec hooks first (extensions can provide type-specific identity values),
 * then falls back to the built-in map, keyed by the data type the column's codec represents.
 */
export function resolveIdentityValue(
  column: StorageColumn,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string | null {
  const referencedType = column.typeRef ? storageTypes[column.typeRef] : undefined;
  const codecId = referencedType?.codecId ?? column.codecId;
  const typeParams = referencedType?.typeParams ?? column.typeParams;
  if (column.many === true) return "'{}'";
  const dataType = sqlDataTypeOfCodec(codecId, types).id;

  const hookDefault = codecHooks.get(codecId)?.resolveIdentityValue?.({
    dataType,
    codecId,
    ...ifDefined('typeParams', typeParams),
  });
  if (hookDefault !== undefined) {
    return hookDefault;
  }

  return buildBuiltinIdentityValue(dataType, typeParams);
}

const IDENTITY_VALUES: ReadonlyMap<string, string> = new Map([
  [pgText.id, "''"],
  [pgChar.id, "''"],
  [pgVarchar.id, "''"],
  [pgInt2.id, '0'],
  [pgInt4.id, '0'],
  [pgInt8.id, '0'],
  [pgFloat4.id, '0'],
  [pgFloat8.id, '0'],
  [pgNumeric.id, '0'],
  [pgBool.id, 'false'],
  [pgUuid.id, "'00000000-0000-0000-0000-000000000000'"],
  [pgJson.id, "'{}'::json"],
  [pgJsonb.id, "'{}'::jsonb"],
  [pgDate.id, "'epoch'"],
  [pgTimestamp.id, "'epoch'"],
  [pgTimestamptz.id, "'epoch'"],
  [pgTime.id, "'00:00:00'"],
  [pgTimetz.id, "'00:00:00+00'"],
  [pgInterval.id, "'0'"],
  [pgBytea.id, "''::bytea"],
  [pgVarbit.id, "B''"],
  [pgTextArray.id, "'{}'"],
]);

/**
 * Returns the built-in identity value (monoid neutral element) as a SQL literal for the given
 * data type — e.g. 0 for integers, '' for text, false for booleans.
 *
 * This is the planner's fallback when no codec hook provides a type-specific identity value.
 *
 * Returns null for other types (for example enums and extension-owned types without a
 * hook), which causes the planner to fall back to the empty-table precheck.
 *
 * @internal Exported for testing only.
 */
export function buildBuiltinIdentityValue(
  dataType: string,
  typeParams?: Record<string, unknown>,
): string | null {
  if (dataType === pgBit.id) return buildBitIdentityValue(typeParams);
  return IDENTITY_VALUES.get(dataType) ?? null;
}

function buildBitIdentityValue(typeParams?: Record<string, unknown>): string | null {
  const length = typeParams?.['length'];
  if (length === undefined) {
    return "B'0'";
  }
  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    return null;
  }
  return `B'${'0'.repeat(length)}'`;
}
