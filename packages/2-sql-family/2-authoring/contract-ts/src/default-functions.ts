import type { ColumnDefault } from '@internal/contract/types';

/** The database's current time, the same default PSL writes as `@default(now())`. */
export function now(): ColumnDefault {
  return { kind: 'function', expression: 'now()' };
}

/** A database-assigned sequence value, the same default PSL writes as `@default(autoincrement())`. */
export function autoincrement(): ColumnDefault {
  return { kind: 'function', expression: 'autoincrement()' };
}
