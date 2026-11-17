import type { PreserveEmptyPredicate, StorageSort } from '@internal/contract/hashing';
import { ifDefined } from '@internal/utils/defined';
import { errorDescriptorHeadHashMismatch } from './errors';
import { recomputePublishedStorageHash } from './hash';

/**
 * Inputs the helper needs to recompute the descriptor's storage hash and
 * compare it to the published `headRef.hash`. Kept structural so the SQL
 * family (and any future target family) can compose the check without
 * coupling to its own descriptor types.
 */
export interface DescriptorSelfConsistencyInputs {
  readonly extensionId: string;
  readonly target: string;
  readonly targetFamily: string;
  /**
   * Family-specific storage object. Typed as `unknown` so callers can
   * pass their own narrow storage shape (e.g. `SqlStorage`) without an
   * inline cast — the helper canonicalises through `JSON.stringify`
   * inside {@link computeStorageHash} and only requires a plain
   * record-shaped value at runtime.
   */
  readonly storage: unknown;
  readonly headRefHash: string;
  readonly shouldPreserveEmpty?: PreserveEmptyPredicate;
  readonly sortStorage?: StorageSort;
}

/**
 * Assert that an extension descriptor is self-consistent: the
 * `headRef.hash` it publishes must match the canonical hash recomputed
 * from its `contractSpace.contractJson`.
 *
 * Recomputes via {@link computeStorageHash} — the same canonical-JSON
 * pipeline the descriptor's own emit pipeline produced the hash with —
 * over `(target, targetFamily, storage)`. Mismatch indicates the
 * extension author bumped `contractJson` without rerunning emit, leaving
 * the descriptor's `headRef.hash` stale; the consumer-side helpers
 * (drift detection, on-disk artefact emission, runner marker writes) all
 * trust `headRef.hash` as the canonical identity, so a stale value would
 * silently corrupt every downstream boundary.
 *
 * Synchronous, pure, no I/O. Throws
 * `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH` on failure with both the
 * recomputed and published hashes in `meta` so callers can surface a
 * clear remediation hint without re-deriving them.
 */
export function assertDescriptorSelfConsistency(inputs: DescriptorSelfConsistencyInputs): void {
  const recomputed = recomputePublishedStorageHash({
    target: inputs.target,
    targetFamily: inputs.targetFamily,
    storage: inputs.storage,
    hooks: {
      ...ifDefined('shouldPreserveEmpty', inputs.shouldPreserveEmpty),
      ...ifDefined('sortStorage', inputs.sortStorage),
    },
  });
  if (recomputed !== inputs.headRefHash) {
    throw errorDescriptorHeadHashMismatch({
      extensionId: inputs.extensionId,
      recomputedHash: recomputed,
      headRefHash: inputs.headRefHash,
    });
  }
}
