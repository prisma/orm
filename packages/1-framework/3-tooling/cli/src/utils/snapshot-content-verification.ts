import type { ContractSerializer } from '@internal/framework-components/control';
import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { createSnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';

/**
 * Build the per-command snapshot content verifier from the target serializer's `normalizeStorage`, the function the family's emit computed the published storage hash with. A target with no serializer (structural test stand-ins), or whose serializer sets `skipsSnapshotContentVerification`, reads without content verification. Build one verifier per command run and share it across every load, so each snapshot hash is recomputed at most once per run.
 */
export function snapshotVerifierFor(config: {
  readonly target: {
    readonly contractSerializer?: Pick<
      ContractSerializer<unknown>,
      'normalizeStorage' | 'skipsSnapshotContentVerification'
    >;
  };
}): SnapshotContentVerifier | undefined {
  const serializer = config.target.contractSerializer;
  if (serializer === undefined || serializer.skipsSnapshotContentVerification === true) {
    return undefined;
  }
  return createSnapshotContentVerifier(serializer.normalizeStorage);
}
