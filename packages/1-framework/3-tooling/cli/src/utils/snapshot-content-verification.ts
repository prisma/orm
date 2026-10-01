import type {
  SnapshotCanonicalizationHooks,
  SnapshotContentVerifier,
} from '@internal/migration-tools/contract-snapshot-store';
import { createSnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';

/**
 * Build the per-command snapshot content verifier from the target
 * serializer's `hashCanonicalizationHooks` — the hooks the family's emit
 * pipeline computed the published storage hash with. The serializer's own
 * `shouldPreserveEmpty` / `sortStorage` must NOT be used here: they govern
 * on-disk serialization and may be broader per target (Postgres preserves
 * required entity-kind fields at default values), so recomputing with them
 * would reject untampered snapshots. A serializer that does not declare its
 * hashing hooks (structural test stand-ins) reads without content
 * verification. Build one verifier per command run and share it across
 * every load, so each snapshot hash is recomputed at most once per run.
 */
export function snapshotVerifierFor(config: {
  readonly target: {
    readonly contractSerializer?: {
      readonly hashCanonicalizationHooks?: SnapshotCanonicalizationHooks;
    };
  };
}): SnapshotContentVerifier | undefined {
  const hooks = config.target.contractSerializer?.hashCanonicalizationHooks;
  if (hooks === undefined) {
    return undefined;
  }
  return createSnapshotContentVerifier(hooks);
}
