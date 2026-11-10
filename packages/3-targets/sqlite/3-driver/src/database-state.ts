import type { DatabaseSync } from 'node:sqlite';

const closedByDriver = new WeakSet<DatabaseSync>();

/** Closes a database the driver opened and records that the driver closed it. */
export function closeDatabase(db: DatabaseSync): void {
  db.close();
  closedByDriver.add(db);
}

/** Whether the driver itself closed this database. */
export function wasClosedByDriver(db: DatabaseSync): boolean {
  return closedByDriver.has(db);
}
