/**
 * Read-only migration-graph queries commands need at the control-api seam.
 */

import {
  type ContractMarkerRecordLike,
  contractHashAtMarker,
} from '@internal/migration-tools/aggregate';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath, findPathWithInvariants } from '@internal/migration-tools/migration-graph';

/** True when the on-disk graph contains a path fromHash → toHash. */
export function hasMigrationPath(graph: MigrationGraph, fromHash: string, toHash: string): boolean {
  return findPath(graph, fromHash, toHash) !== null;
}

/**
 * Whether `db migrate` alone would move a database at `marker` to `target` with the migrations on
 * disk: a path leads there and covers every invariant the target requires that the marker does not
 * record. False when the database is already at the target, where `db migrate` has nothing to do.
 */
export function migrationsLeadToTarget(
  graph: MigrationGraph,
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly hash: string; readonly invariants: readonly string[] },
): boolean {
  const from = contractHashAtMarker(marker);
  if (from === target.hash) return false;
  const recorded = new Set(marker?.invariants ?? []);
  const missing = new Set(target.invariants.filter((invariant) => !recorded.has(invariant)));
  return findPathWithInvariants(graph, from, target.hash, missing) !== null;
}
