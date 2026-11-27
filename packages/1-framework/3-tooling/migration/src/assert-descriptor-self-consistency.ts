import { CONTRACT_FORMAT_VERSIONS, readFormatVersion } from '@internal/contract/format-version';
import type { NormalizeStorage } from '@internal/contract/hashing';
import { blindCast } from '@internal/utils/casts';
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
  /** The extension's bundled `contract.json`, as the descriptor imports it. */
  readonly contractJson: unknown;
  readonly headRefHash: string;
  /** The family's normal form of `storage`. */
  readonly normalizeStorage: NormalizeStorage;
}

/**
 * Assert that an extension descriptor is self-consistent: the
 * `headRef.hash` it publishes must match the canonical hash recomputed
 * from its `contractSpace.contractJson`.
 *
 * Reads the bundled contract's format version first, and throws a format
 * version error for one this release cannot read. Recomputes via
 * {@link computeStorageHash} — the same canonical-JSON pipeline the
 * descriptor's own emit pipeline produced the hash with — over
 * `(target, targetFamily, storage)`. Mismatch indicates the
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
  readFormatVersion(inputs.contractJson, {
    kind: 'contract',
    knownVersions: CONTRACT_FORMAT_VERSIONS,
    path: 'contract.json',
    bundledIn: inputs.extensionId,
  });
  const contract = blindCast<
    { readonly target?: unknown; readonly targetFamily?: unknown; readonly storage?: unknown },
    'readFormatVersion accepted the document, so it is an object; only the fields the hash covers are read'
  >(inputs.contractJson);
  const recomputed = recomputePublishedStorageHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    storage: contract.storage,
    normalizeStorage: inputs.normalizeStorage,
  });
  if (recomputed !== inputs.headRefHash) {
    throw errorDescriptorHeadHashMismatch({
      extensionId: inputs.extensionId,
      recomputedHash: recomputed,
      headRefHash: inputs.headRefHash,
    });
  }
}
