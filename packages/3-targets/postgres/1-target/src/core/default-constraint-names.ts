import { postgresObjectName, storedIdentifier } from './postgres-object-name';

/*
 * The names the planner gives a primary key, unique constraint or foreign key the contract leaves unnamed, each as Postgres stores it, so a later drop or rename finds it and no DDL writes a name Postgres would cut. They derive from the table name, so a table rename leaves them stale until the planner renames them too. A Prisma 7 contract states a constraint's name only where Prisma 7's differs from these, so changing them changes the storage hash of such contracts and needs an upgrade instruction.
 */

/** `{table}_pkey` cut as Postgres cuts the name of a primary key it names itself: `CREATE TABLE` writes an unnamed primary key. */
export function defaultPrimaryKeyName(tableName: string): string {
  return postgresObjectName(tableName, undefined, 'pkey');
}

/** `{table}_{columns}_key`, cut to the 63 bytes Postgres stores. */
export function defaultUniqueName(tableName: string, columns: readonly string[]): string {
  return storedIdentifier(`${tableName}_${columns.join('_')}_key`);
}

/** `{table}_{columns}_fkey`, cut to the 63 bytes Postgres stores. */
export function defaultForeignKeyName(tableName: string, columns: readonly string[]): string {
  return storedIdentifier(`${tableName}_${columns.join('_')}_fkey`);
}
