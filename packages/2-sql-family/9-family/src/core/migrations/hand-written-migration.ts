/** The steps of a migration the user writes by hand, which rewrites `what` with the other operations of the change. */
export function handWrittenMigrationSteps(what: string): string {
  return `run prisma migration new, and in the operations of the migration.ts it writes, rewrite ${what} yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;
}

/**
 * The way out of a refusal that no statement or second plan can lift: a migration the user writes
 * by hand, which rewrites `what` with the other operations of the change.
 */
export function handWrittenMigrationAdvice(what: string): string {
  return `Write this change as a hand-written migration instead: ${handWrittenMigrationSteps(what)}`;
}
