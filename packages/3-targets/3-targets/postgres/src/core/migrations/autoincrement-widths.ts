/** How an `autoincrement()` column of one integer width is written: its SERIAL pseudo-type when the column is created, and the `AS` type of the sequence `setDefault` attaches to an existing column. */
export interface AutoincrementWidth {
  readonly serialType: 'SMALLSERIAL' | 'SERIAL' | 'BIGSERIAL';
  readonly sequenceType: 'smallint' | 'integer' | 'bigint';
}

const SMALL: AutoincrementWidth = { serialType: 'SMALLSERIAL', sequenceType: 'smallint' };
const REGULAR: AutoincrementWidth = { serialType: 'SERIAL', sequenceType: 'integer' };
const BIG: AutoincrementWidth = { serialType: 'BIGSERIAL', sequenceType: 'bigint' };

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
