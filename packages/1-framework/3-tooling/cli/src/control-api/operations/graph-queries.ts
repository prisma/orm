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

/** The invariants `target` requires that the database at `marker` does not record. */
export function missingInvariants(
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly invariants: readonly string[] },
): ReadonlySet<string> {
  const recorded = new Set(marker?.invariants ?? []);
  return new Set(target.invariants.filter((invariant) => !recorded.has(invariant)));
}

/**
 * Whether `db migrate` alone would move a database at `marker` to `target` with the migrations on
 * disk: a path leads there and covers every invariant the target requires that the marker does not
 * record. False when the database is already at the target and records every such invariant, where
 * `db migrate` has nothing to do.
 */
export function migrationsLeadToTarget(
  graph: MigrationGraph,
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly hash: string; readonly invariants: readonly string[] },
): boolean {
  const from = contractHashAtMarker(marker);
  const missing = missingInvariants(marker, target);
  if (from === target.hash && missing.size === 0) return false;
  return findPathWithInvariants(graph, from, target.hash, missing) !== null;
}
