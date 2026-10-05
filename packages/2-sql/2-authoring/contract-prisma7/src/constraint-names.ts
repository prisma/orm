import { prisma7ConstraintName } from './indexes';

/** Prisma 7's primary key name: `map`, or `{table}_pkey` cut to `maxBytes`. */
export function prisma7PrimaryKeyName(
  tableName: string,
  map: string | undefined,
  maxBytes: number,
): string {
  return map ?? prisma7ConstraintName(tableName, '_pkey', maxBytes);
}

/** Prisma 7's foreign key name: `map`, or `{table}_{columns}_fkey` cut to `maxBytes`. */
export function prisma7ForeignKeyName(
  tableName: string,
  columns: readonly string[],
  map: string | undefined,
  maxBytes: number,
): string {
  return map ?? prisma7ConstraintName(`${tableName}_${columns.join('_')}`, '_fkey', maxBytes);
}

/** Prisma 7's primary key name for the junction table of an implicit many-to-many relation. */
export function prisma7JunctionPrimaryKeyName(relationName: string, maxBytes: number): string {
  return prisma7ConstraintName(`_${relationName}`, '_AB_pkey', maxBytes);
}

/** Prisma 7's name for the junction foreign key on column `A` or `B`. */
export function prisma7JunctionForeignKeyName(
  relationName: string,
  column: 'A' | 'B',
  maxBytes: number,
): string {
  return prisma7ConstraintName(`_${relationName}`, `_${column}_fkey`, maxBytes);
}

/**
 * The name a contract states for a constraint Prisma 7 named `prisma7Name`: the name itself where the target would derive a different one, and `undefined` where the two agree, so the contract stays unnamed there and a table rename keeps deriving it.
 */
export function statedConstraintName(prisma7Name: string, derivedName: string): string | undefined {
  return prisma7Name === derivedName ? undefined : prisma7Name;
}
