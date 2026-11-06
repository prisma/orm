import { dataTypeParams, type TypeLookups } from '@internal/framework-components/codec';
import { renderSqlTypeName, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import type { StorageColumn } from '@internal/sql-contract/types';
import { autoincrementWidthOfDataType } from './autoincrement-widths';

/**
 * Renders the SQL type for a column in DDL context: the name its codec's data type is written
 * with, and its parameters.
 *
 * @param allowPseudoTypes - When true (default), autoincrement integer columns
 *   produce SERIAL/BIGSERIAL/SMALLSERIAL pseudo-types. Set to false for contexts
 *   like ALTER COLUMN TYPE where pseudo-types are invalid.
 */
export function buildColumnTypeSql(
  column: Pick<StorageColumn, 'codecId' | 'many' | 'typeParams' | 'default'>,
  types: TypeLookups,
  allowPseudoTypes = true,
): string {
  const dataType = sqlDataTypeOfCodec(column.codecId, types);

  if (allowPseudoTypes && isAutoincrement(column.default)) {
    const width = autoincrementWidthOfDataType(dataType.id);
    if (width !== undefined) return width.serialType;
  }

  const typeSql = renderSqlTypeName(dataType, dataTypeParams(dataType, column.typeParams));
  return column.many ? `${typeSql}[]` : typeSql;
}

function isAutoincrement(columnDefault: StorageColumn['default']): boolean {
  return columnDefault?.kind === 'function' && columnDefault.expression === 'autoincrement()';
}
