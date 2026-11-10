/**
 * Shared relational-diff types and helpers. The coordinate-based issue diff
 * this module used to house (`collectSqlSchemaIssues` /
 * `collectSqlSchemaIssuesPerNamespace`) retired once the migration planner
 * took `plan(start, end)` over the one differ (`buildPostgresPlanDiff` /
 * `buildSqlitePlanDiff`); what remains here is consumed by the surviving
 * verify verdict (`schema-verify.ts`) and the control adapters.
 */

/**
 * Compares two arrays of strings for equality (order-sensitive).
 */
export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
