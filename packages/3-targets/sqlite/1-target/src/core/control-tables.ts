export const MARKER_TABLE_NAME = '_prisma_marker';
export const LEDGER_TABLE_NAME = '_prisma_ledger';

/**
 * Control tables the runner creates/manages. The planner must not drop these
 * when reconciling "extra" tables against the contract.
 */
export const CONTROL_TABLE_NAMES: ReadonlySet<string> = new Set([
  MARKER_TABLE_NAME,
  LEDGER_TABLE_NAME,
]);
