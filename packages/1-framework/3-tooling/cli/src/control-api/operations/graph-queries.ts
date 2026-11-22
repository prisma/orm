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
 * How a database at `marker` reaches `target` through migrations:
 * - `none-needed`: it is at the target and records every invariant the target requires;
 * - `on-disk`: a path on disk leads there and provides every such invariant it does not record, so
 *   `db migrate` alone moves it;
 * - `invariants-missing`: it is at the target, but no migration on disk provides an invariant it
 *   lacks, and `migration plan` cannot author one, because a plan from a contract to itself is empty;
 * - `missing`: a migration still has to be authored.
 */
export type MigrationsToTarget = 'none-needed' | 'on-disk' | 'invariants-missing' | 'missing';

export function migrationsToTarget(
  graph: MigrationGraph,
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly hash: string; readonly invariants: readonly string[] },
): MigrationsToTarget {
  const from = contractHashAtMarker(marker);
  const missing = missingInvariants(marker, target);
  if (from === target.hash && missing.size === 0) return 'none-needed';
  if (findPathWithInvariants(graph, from, target.hash, missing) !== null) return 'on-disk';
  return from === target.hash ? 'invariants-missing' : 'missing';
}
