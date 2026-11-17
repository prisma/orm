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
      ? `${executed} of ${planned} operation(s); ${skippedOperationsText(planned - executed)}`
      : `${executed} operation(s)`;
  return `Applied ${migrations} migration(s) (${operations}) across ${spaces} contract space(s)`;
}

/** Why an apply ran fewer operations than it planned: the runner skipped those whose postcheck already held. */
export function skippedOperationsText(skipped: number): string {
  return `the other ${skipped} had nothing to do, since their postchecks already held`;
}
