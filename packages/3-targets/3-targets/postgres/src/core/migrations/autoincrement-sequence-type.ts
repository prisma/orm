const SEQUENCE_TYPE_BY_COLUMN_TYPE: ReadonlyMap<string, 'smallint' | 'integer' | 'bigint'> =
  new Map([
    ['int2', 'smallint'],
    ['smallint', 'smallint'],
    ['int4', 'integer'],
    ['integer', 'integer'],
    ['int', 'integer'],
    ['int8', 'bigint'],
    ['bigint', 'bigint'],
  ]);

/**
 * The `AS` type of the sequence an `autoincrement()` default attaches to a column of `columnType`, matching the sequence a SERIAL column of that width gets. `undefined` for a column that is not a scalar smallint, integer or bigint.
 */
export function autoincrementSequenceType(
  columnType: string,
): 'smallint' | 'integer' | 'bigint' | undefined {
  return SEQUENCE_TYPE_BY_COLUMN_TYPE.get(columnType.toLowerCase());
}
