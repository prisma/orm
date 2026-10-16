import type { CodecControlHooks } from '@internal/family-sql/control';
import { type SqlTypeLookups, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import type { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { encodeSqliteDatetime } from '../codecs';
import {
  sqliteBlob,
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteDatetime,
  sqliteInteger,
  sqliteJson,
  sqliteReal,
  sqliteText,
} from '../data-types';
import { escapeLiteral } from '../sql-utils';

const DATA_TYPE_FILL_VALUES: ReadonlyMap<string, string> = new Map([
  [sqliteDatetime.id, `'${escapeLiteral(encodeSqliteDatetime(new Date(0)))}'`],
  [sqliteJson.id, `'{}'`],
  [sqliteInteger.id, '0'],
  [sqliteReal.id, '0'],
  [sqliteText.id, "''"],
  [sqliteCharacter.id, "''"],
  [sqliteCharacterVarying.id, "''"],
  [sqliteBlob.id, "X''"],
]);

function isParamRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The SQL value a new required column takes in the rows a table already has, or `undefined` when
 * its type has none: the column's codec hook first, as on Postgres, then a value of its data type.
 */
export function sqliteFillValue(
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  types: SqlTypeLookups,
): string | undefined {
  const codecRef = column.codecRef;
  if (codecRef === undefined || column.many === true) return undefined;
  const dataType = sqlDataTypeOfCodec(codecRef.codecId, types).id;
  const fromHook = codecHooks.get(codecRef.codecId)?.resolveIdentityValue?.({
    dataType,
    codecId: codecRef.codecId,
    ...(isParamRecord(codecRef.typeParams) ? { typeParams: codecRef.typeParams } : {}),
  });
  if (fromHook !== undefined) return fromHook ?? undefined;
  return DATA_TYPE_FILL_VALUES.get(dataType);
}
