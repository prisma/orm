import type { ContractMarkerRecord } from '@internal/contract/types';
import {
  compareMarkerDatabasePolicies,
  type DatabasePolicies,
} from '@internal/framework-components/control';

/** Why a marker's compare-and-swap failed, read from the marker as it is afterwards. */
export type MarkerSwapFailure =
  | { readonly kind: 'storageHashMoved'; readonly found: ContractMarkerRecord | null }
  | {
      readonly kind: 'policiesMoved';
      readonly checked: DatabasePolicies;
      readonly found: DatabasePolicies;
    }
  | {
      readonly kind: 'policiesUnreadable';
      readonly checked: DatabasePolicies;
      readonly why: string;
    };

/**
 * Why the swap of a marker expected at `expectedStorageHash`, guarded by `heldPolicies` when given,
 * failed. `found` is the marker read after the swap. A marker that holds both again was changed and
 * restored by another process in between, which is reported as a moved marker.
 */
export function markerSwapFailure(
  found: ContractMarkerRecord | null,
  expectedStorageHash: string,
  heldPolicies: DatabasePolicies | undefined,
): MarkerSwapFailure {
  if (heldPolicies === undefined || found?.storageHash !== expectedStorageHash) {
    return { kind: 'storageHashMoved', found };
  }
  const comparison = compareMarkerDatabasePolicies(found, heldPolicies);
  switch (comparison.kind) {
    case 'moved':
      return { kind: 'policiesMoved', checked: heldPolicies, found: comparison.found };
    case 'unreadable':
      return { kind: 'policiesUnreadable', checked: heldPolicies, why: comparison.why };
    case 'held':
      return { kind: 'storageHashMoved', found };
  }
}
