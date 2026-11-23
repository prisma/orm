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
 *   `db migrate` alone moves it; `unmarked` when the database has no marker, so that path starts at
 *   the empty contract and fits only an empty database;
 * - `at-target-missing-invariants`: it is at the target's contract, but no migration on disk
 *   provides `missingInvariants`, and `migration plan` cannot write one, because a plan from a
 *   contract to itself is empty, so the migration is written by hand. `newMigration` is there when a
 *   migration ends at the target, so `migration new --from` it resolves: that writes a migration
 *   from the target to itself once the emitted contract is the target, which it already is unless
 *   `emitFirst`;
 * - `plan-needed`: the database is not at the target's contract, so a migration has to be planned,
 *   and it has to provide `missingInvariants`.
 *
 * @internal
 */
export type MigrationsToTarget =
  | { readonly kind: 'none-needed' }
  | { readonly kind: 'on-disk'; readonly unmarked?: true }
  | {
      readonly kind: 'at-target-missing-invariants';
      readonly missingInvariants: readonly string[];
      readonly newMigration?: { readonly from: string; readonly emitFirst: boolean };
    }
  | { readonly kind: 'plan-needed'; readonly missingInvariants: readonly string[] };

/** `space.emittedHash` is the contract the caller takes as emitted, as `PlanSpace.emittedHash` describes. */
export function migrationsToTarget(
  space: { readonly graph: MigrationGraph; readonly emittedHash?: string },
  marker: ContractMarkerRecordLike | null | undefined,
  target: { readonly hash: string; readonly invariants: readonly string[] },
): MigrationsToTarget {
  const from = contractHashAtMarker(marker);
  const missing = missingInvariants(marker, target);
  if (from === target.hash && missing.size === 0) return { kind: 'none-needed' };
  if (findPathWithInvariants(space.graph, from, target.hash, missing) !== null) {
    return marker === null || marker === undefined
      ? { kind: 'on-disk', unmarked: true }
      : { kind: 'on-disk' };
  }
  const missingInvariantIds = [...missing].sort();
  if (from !== target.hash) return { kind: 'plan-needed', missingInvariants: missingInvariantIds };
  const migrationEndsAtTarget = (space.graph.reverseChain.get(target.hash)?.length ?? 0) > 0;
  return {
    kind: 'at-target-missing-invariants',
    missingInvariants: missingInvariantIds,
    ...ifDefined(
      'newMigration',
      migrationEndsAtTarget
        ? { from: target.hash, emitFirst: space.emittedHash !== target.hash }
        : undefined,
    ),
  };
}
