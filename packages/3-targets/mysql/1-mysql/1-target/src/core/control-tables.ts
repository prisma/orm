export const MARKER_TABLE_NAME = '_prisma_marker';
export const LEDGER_TABLE_NAME = '_prisma_ledger';

/** The tables the migration runner owns, which introspection leaves out and the planner never drops. MySQL has no schema inside a database to hold them, so they sit beside the application's tables. */
export const CONTROL_TABLE_NAMES: ReadonlySet<string> = new Set([
  MARKER_TABLE_NAME,
  LEDGER_TABLE_NAME,
]);
