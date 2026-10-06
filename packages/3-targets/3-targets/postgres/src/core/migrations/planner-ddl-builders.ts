import {
  dataTypeParams,
  renderSqlTypeName,
  type SqlTypeLookups,
  sqlDataTypeOfCodec,
} from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { pgInt2, pgInt4, pgInt8, pgJson, pgJsonb } from '../data-types';
import { postgresDateTimeDdlText } from '../date-time-ddl-text';
import { escapeLiteral } from '../sql-utils';

const SERIAL_TYPES: ReadonlyMap<string, string> = new Map([
  [pgInt4.id, 'SERIAL'],
  [pgInt8.id, 'BIGSERIAL'],
  [pgInt2.id, 'SMALLSERIAL'],
]);

const JSON_DATA_TYPES: ReadonlySet<string> = new Set([pgJson.id, pgJsonb.id]);

/**
 * Renders the SQL type for a column in DDL context: the name its codec's data type is written
 * with, and its parameters. A `typeRef` column is written as a column of the referenced type.
 *
 * @param allowPseudoTypes - When true (default), autoincrement integer columns
 *   produce SERIAL/BIGSERIAL/SMALLSERIAL pseudo-types. Set to false for contexts
 *   like ALTER COLUMN TYPE where pseudo-types are invalid.
 */
export function buildColumnTypeSql(
  column: Pick<StorageColumn, 'codecId' | 'many' | 'typeParams' | 'typeRef' | 'default'>,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
  allowPseudoTypes = true,
): string {
  const referenced = column.typeRef === undefined ? undefined : storageTypes[column.typeRef];
  const resolved = referenced ?? column;
  const dataType = sqlDataTypeOfCodec(resolved.codecId, types);

  if (allowPseudoTypes) {
    const columnDefault = column.default;
    const serial = SERIAL_TYPES.get(dataType.id);
    if (
      serial !== undefined &&
      columnDefault?.kind === 'function' &&
      columnDefault.expression === 'autoincrement()'
    ) {
      return serial;
    }
  }

  const typeSql = renderSqlTypeName(dataType, dataTypeParams(dataType, resolved.typeParams));
  return column.many ? `${typeSql}[]` : typeSql;
}

/**
 * The column a default is written for: its type as SQL, whether it is a list, and the id of its
 * data type, which decides whether a JSON value is cast and the text a date or time value is
 * written as. The value arrives in canonical form.
 */
export type DefaultColumn = Pick<StorageColumn, 'many' | 'nativeType'> & {
  readonly dataTypeId: string;
};

export function renderDefaultLiteral(value: unknown, column?: DefaultColumn): string {
  if (column?.many && Array.isArray(value)) {
    return renderArrayLiteralDefault(value, column.nativeType, column.dataTypeId);
  }
  const isJsonColumn = column !== undefined && JSON_DATA_TYPES.has(column.dataTypeId);
  if (isJsonColumn && typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return `'${escapeLiteral(JSON.stringify(value))}'::${column.nativeType}`;
  }
  return renderScalarLiteral(value, column?.dataTypeId);
}

/** A date or time value is written through the one function every DDL path uses for it. */
function renderScalarLiteral(value: unknown, dataTypeId: string | undefined): string {
  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(postgresDateTimeDdlText(value, dataTypeId))}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'NULL';
  }
  return `'${escapeLiteral(JSON.stringify(value))}'`;
}

/**
 * An `ARRAY[...]` of quoted elements has type `text[]`, which Postgres does not assign to a list of
 * numbers, decimals, timestamps or enums, so the constructor is cast to the list type. Each element
 * is the text Postgres reads for its type: an `int8` or `numeric` value as decimal text, a date or
 * time value in its type's canonical form. `nativeType` is the element type or the list type,
 * written as SQL, so a user-defined type name arrives already quoted.
 */
function renderArrayLiteralDefault(
  elements: unknown[],
  nativeType: string,
  dataTypeId: string | undefined,
): string {
  if (elements.length === 0) {
    return "'{}'";
  }
  const rendered = `ARRAY[${elements.map((el) => renderScalarLiteral(el, dataTypeId)).join(', ')}]`;
  if (nativeType === '') return rendered;
  return `${rendered}::${nativeType.endsWith('[]') ? nativeType : `${nativeType}[]`}`;
}
