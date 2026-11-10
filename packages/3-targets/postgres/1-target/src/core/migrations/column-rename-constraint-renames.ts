import type { RenameConstraintCall } from './op-factory-call';
import {
  pairedConstraintRenames,
  type TableRenameConstraintInput,
} from './table-rename-constraint-renames';

/**
 * The constraint renames that follow a column rename. Each unique constraint and foreign key on
 * the renamed column is paired with the destination constraint of the same kind on the same
 * columns, and renamed to the destination's explicit name, or else to the name the planner derives
 * from the table and the new column names, when that differs from its name in the database. The
 * primary key's derived name does not depend on its columns, so it is left alone. `previous` is
 * the table after the column rename, its constraint names as they are in the database.
 */
export function constraintRenamesForColumnRename(
  input: TableRenameConstraintInput & { readonly column: string },
): readonly RenameConstraintCall[] {
  return pairedConstraintRenames(input, {
    primaryKey: false,
    onColumns: (columns) => columns.includes(input.column),
  });
}
