import { EMPTY_CONTRACT_HASH } from '../constants';

/**
 * Structural shape the aggregate planner / verifier accept for marker
 * rows. Mirrors `family.readAllMarkers(...)` outputs across SQL and
 * Mongo families: a `(storageHash, invariants)` pair plus an optional
 * `profileHash` the verifier uses to align the marker with the
 * destination contract's profile envelope.
 *
 * Typed structurally so `migration-tools` stays framework-neutral; SQL
 * and Mongo families pass their typed `ContractMarkerRecord` through
 * unchanged.
 */
export interface ContractMarkerRecordLike {
  readonly storageHash: string;
  readonly invariants: readonly string[];
  readonly profileHash?: string;
}

/** The contract hash a database is at: its marker's storage hash, or the empty contract when it has no marker. */
export function contractHashAtMarker(
  marker: Pick<ContractMarkerRecordLike, 'storageHash'> | null | undefined,
): string {
  return marker?.storageHash ?? EMPTY_CONTRACT_HASH;
}
