/**
 * Read-only migration-graph queries commands need at the control-api seam.
 */

import {
  type ContractMarkerRecordLike,
  contractHashAtMarker,
} from '@internal/migration-tools/aggregate';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath, findPathWithInvariants } from '@internal/migration-tools/migration-graph';
import { ifDefined } from '@internal/utils/defined';

/** True when the on-disk graph contains a path fromHash → toHash. */
export function hasMigrationPath(graph: MigrationGraph, fromHash: string, toHash: string): boolean {
  return findPath(graph, fromHash, toHash) !== null;
}

/** The invariants `target` requires that the database at `marker` does not record. */
function missingInvariants(
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
 * - `invariants-not-on-disk`: it is at the target, but no migration on disk provides
 *   `missingInvariants`, and `migration plan` cannot write one, because a plan from a contract to
 *   itself is empty. `newMigrationFrom` is the `--from` that makes `migration new` write a migration
 *   from the target to itself, present when the emitted contract is the target and a migration ends
 *   there;
 * - `not-on-disk`: a migration has to be planned, and it has to provide `missingInvariants`.
 */
export type MigrationsToTarget =
  | { readonly kind: 'none-needed' }
  | { readonly kind: 'on-disk' }
  | {
      readonly kind: 'invariants-not-on-disk';
      readonly missingInvariants: readonly string[];
      readonly newMigrationFrom?: string;
    }
  | { readonly kind: 'not-on-disk'; readonly missingInvariants: readonly string[] };

export function migrationsToTarget(
  space: { readonly graph: MigrationGraph; readonly emittedHash?: string },
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly hash: string; readonly invariants: readonly string[] },
): MigrationsToTarget {
  const from = contractHashAtMarker(marker);
  const missing = missingInvariants(marker, target);
  if (from === target.hash && missing.size === 0) return { kind: 'none-needed' };
  if (findPathWithInvariants(space.graph, from, target.hash, missing) !== null) {
    return { kind: 'on-disk' };
  }
  const missingInvariantIds = [...missing].sort();
  if (from !== target.hash) return { kind: 'not-on-disk', missingInvariants: missingInvariantIds };
  const newMigrationFrom =
    space.emittedHash === target.hash &&
    (space.graph.reverseChain.get(target.hash)?.length ?? 0) > 0
      ? target.hash
      : undefined;
  return {
    kind: 'invariants-not-on-disk',
    missingInvariants: missingInvariantIds,
    ...ifDefined('newMigrationFrom', newMigrationFrom),
  };
}
