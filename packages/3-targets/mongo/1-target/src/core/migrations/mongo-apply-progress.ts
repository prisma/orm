import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';

/**
 * The document counts the runner reads just before an `$out` copy that the planner prints: the
 * target's, and the number of source documents the copy's filters select. Writes to both
 * collections are stopped while the apply runs, so once the copy has finished the target holds
 * their sum.
 */
export interface CopyCounts {
  readonly target: number;
  readonly selected: number;
}

/**
 * How far an apply got. `finished` operations ran to their end; when `inFlight` is true, the next
 * one threw while it ran, so its commands may or may not have taken effect. `copyCounts` holds
 * the counts read before the next operation, when it is a copy they are read for. It is
 * `undefined` for that copy when they cannot show whether it finished: a read failed, a count is
 * not exact, or the two collections have different collations. The copy runs either way.
 */
export interface ApplyProgress {
  operations: readonly AnyMongoMigrationOperation[];
  finished: number;
  inFlight: boolean;
  copyCounts: CopyCounts | undefined;
}

/** The operations that finished, and the one that was running when the apply stopped. */
export function operationsThatMayHaveRun(
  progress: Readonly<ApplyProgress>,
): readonly AnyMongoMigrationOperation[] {
  return progress.operations.slice(0, progress.finished + (progress.inFlight ? 1 : 0));
}
