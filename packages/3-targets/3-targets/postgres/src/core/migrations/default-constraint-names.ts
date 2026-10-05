/**
 * The names the planner gives a primary key, unique constraint or foreign key the contract leaves unnamed. They derive from the table name, so renaming the table leaves them stale until the planner renames them too.
 */

export function defaultPrimaryKeyName(tableName: string): string {
  return `${tableName}_pkey`;
}

export function defaultUniqueName(tableName: string, columns: readonly string[]): string {
  return `${tableName}_${columns.join('_')}_key`;
}

export function defaultForeignKeyName(tableName: string, columns: readonly string[]): string {
  return `${tableName}_${columns.join('_')}_fkey`;
}
