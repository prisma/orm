import type { ColumnDefault } from '@internal/contract/types';
import { pgInt2, pgInt4, pgInt8 } from '../data-types';

/** How an `autoincrement()` column of one integer width is written: its SERIAL pseudo-type when the column is created, and the `AS` type of the sequence `setDefault` attaches to an existing column. */
export interface AutoincrementWidth {
  readonly serialType: 'SMALLSERIAL' | 'SERIAL' | 'BIGSERIAL';
  readonly sequenceType: 'smallint' | 'integer' | 'bigint';
  /** The largest value of `sequenceType`, as decimal text. */
  readonly maxValue: string;
}

const SMALL: AutoincrementWidth = {
  serialType: 'SMALLSERIAL',
  sequenceType: 'smallint',
  maxValue: '32767',
};
const REGULAR: AutoincrementWidth = {
  serialType: 'SERIAL',
  sequenceType: 'integer',
  maxValue: '2147483647',
};
const BIG: AutoincrementWidth = {
  serialType: 'BIGSERIAL',
  sequenceType: 'bigint',
  maxValue: '9223372036854775807',
};

const WIDTH_BY_COLUMN_TYPE: ReadonlyMap<string, AutoincrementWidth> = new Map([
  ['int2', SMALL],
  ['smallint', SMALL],
  ['int4', REGULAR],
  ['integer', REGULAR],
  ['int8', BIG],
  ['bigint', BIG],
]);

/** The autoincrement width of a column of `columnType`; `undefined` for a column that is not a scalar smallint, integer or bigint. */
export function autoincrementWidth(columnType: string): AutoincrementWidth | undefined {
  return WIDTH_BY_COLUMN_TYPE.get(columnType.toLowerCase());
}

const WIDTH_BY_PSEUDO_TYPE: ReadonlyMap<string, AutoincrementWidth> = new Map([
  ['smallserial', SMALL],
  ['serial2', SMALL],
  ['serial', REGULAR],
  ['serial4', REGULAR],
  ['bigserial', BIG],
  ['serial8', BIG],
]);

/** The autoincrement width of a column written with a SERIAL pseudo-type, such as `SERIAL` or `bigserial`; `undefined` for any other type. Postgres stores the column as the width's `sequenceType`. */
export function autoincrementWidthOfPseudoType(columnType: string): AutoincrementWidth | undefined {
  return WIDTH_BY_PSEUDO_TYPE.get(columnType.trim().toLowerCase());
}

const WIDTH_BY_DATA_TYPE: ReadonlyMap<string, AutoincrementWidth> = new Map([
  [pgInt2.id, SMALL],
  [pgInt4.id, REGULAR],
  [pgInt8.id, BIG],
]);

/** The autoincrement width of a column whose data type is `dataTypeId`; `undefined` unless it is `pg/int2`, `pg/int4` or `pg/int8`. */
export function autoincrementWidthOfDataType(dataTypeId: string): AutoincrementWidth | undefined {
  return WIDTH_BY_DATA_TYPE.get(dataTypeId);
}

/** Whether a schema column takes its values from a sequence: a SERIAL column's `nextval(...)` default and an identity column both read as `autoincrement()`. */
export function hasAutoincrementDefault(column: {
  readonly resolvedDefault?: ColumnDefault;
}): boolean {
  return (
    column.resolvedDefault?.kind === 'function' &&
    column.resolvedDefault.expression === 'autoincrement()'
  );
}
