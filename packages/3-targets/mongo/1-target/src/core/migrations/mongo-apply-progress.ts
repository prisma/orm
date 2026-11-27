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
 * the counts read before the next operation, when it is a copy they are read for.
 */
export interface ApplyProgress {
  operations: readonly AnyMongoMigrationOperation[];
  finished: number;
  inFlight: boolean;
  copyCounts: CopyCounts | undefined;
}
