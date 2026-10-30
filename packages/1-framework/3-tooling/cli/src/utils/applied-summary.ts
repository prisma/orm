/**
 * What `db migrate` says it applied. The runner skips an operation whose postcheck already holds
 * before it runs, so when it ran fewer operations than the migrations hold, the summary says why.
 */
export function appliedSummary(counts: {
  readonly migrations: number;
  readonly planned: number;
  readonly executed: number;
  readonly spaces: number;
}): string {
  const { migrations, planned, executed, spaces } = counts;
  const operations =
    executed < planned
      ? `${executed} of ${planned} operation(s); the other ${planned - executed} had nothing to do, since their postchecks already held`
      : `${executed} operation(s)`;
  return `Applied ${migrations} migration(s) (${operations}) across ${spaces} contract space(s)`;
}
