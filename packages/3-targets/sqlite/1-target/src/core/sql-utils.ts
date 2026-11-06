/**
 * Shared SQL utility functions for the SQLite target.
 *
 * These functions handle safe SQL identifier and literal escaping. They
 * live in `target-sqlite` (mirroring `target-postgres/src/core/sql-utils.ts`)
 * so both the control adapter (used at emit time) and the runtime adapter
 * (used at execute time) can depend on them through a single one-way edge:
 * `adapter-sqlite → target-sqlite`. Hosting them target-side avoids the
 * cyclic workspace dependency that would arise if `target-sqlite` reached
 * back into `adapter-sqlite` for these primitives.
 */

import { sqliteError } from './errors';

export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw sqliteError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot be empty', {
      meta: { value: identifier, context: 'identifier' },
    });
  }
  if (identifier.includes('\0')) {
    throw sqliteError('CONTRACT.IDENTIFIER_INVALID', 'Identifier cannot contain null bytes', {
      meta: { value: identifier.replace(/\0/g, '\\0'), context: 'identifier' },
    });
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw sqliteError('CONTRACT.IDENTIFIER_INVALID', 'Literal value cannot contain null bytes', {
      meta: { value: value.replace(/\0/g, '\\0'), context: 'literal' },
    });
  }
  return value.replace(/'/g, "''");
}

/** The quotes this target's SQL knows, for the check of SQL a migration writes into a statement. */
export const SQLITE_QUOTING = [
  { open: "'", close: "'", doubledCloseEscapes: true, backslashEscapes: false },
  { open: '"', close: '"', doubledCloseEscapes: true, backslashEscapes: false },
  { open: '`', close: '`', doubledCloseEscapes: true, backslashEscapes: false },
  { open: '[', close: ']', doubledCloseEscapes: false, backslashEscapes: false },
] as const;
