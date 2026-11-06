import type { StorageTable } from '@internal/sql-contract/types';

/**
 * Whether a required column the plan adds to a table with rows may take one temporary value in
 * every row. Not when it is in the primary key, a unique constraint or a foreign key, which one
 * value in every row would break, and not when its values come from a value set, since no one value
 * stands for every member. Such a column is added for an empty table only.
 */
export function columnTakesTemporaryValue(table: StorageTable, column: string): boolean {
  return (
    table.columns[column]?.valueSet === undefined &&
    !(table.primaryKey?.columns.includes(column) ?? false) &&
    !table.uniques.some(({ columns }) => columns.includes(column)) &&
    !table.foreignKeys.some(({ source }) => source.columns.includes(column))
  );
}
