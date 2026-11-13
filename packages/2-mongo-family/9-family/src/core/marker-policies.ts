import type { ContractMarkerRecord } from '@internal/contract/types';
import {
  compareMarkerDatabasePolicies,
  type DatabasePolicies,
} from '@internal/framework-components/control';

/** Why a marker's compare-and-swap failed, read from the marker as it is afterwards. */
export type MarkerSwapFailure =
  | { readonly kind: 'storageHashMoved'; readonly found: ContractMarkerRecord | null }
  | { readonly kind: 'policiesMoved'; readonly found: DatabasePolicies }
  | { readonly kind: 'policiesUnreadable'; readonly why: string }
  | { readonly kind: 'markerChanged'; readonly found: ContractMarkerRecord };

/**
 * Why the swap of a marker expected at `expectedStorageHash`, guarded by `checkedPolicies` when given,
 * failed. `found` is the marker read after the swap. When it holds both again, another process
 * changed the marker and changed it back while the swap ran.
 */
export function markerSwapFailure(
  found: ContractMarkerRecord | null,
  expectedStorageHash: string,
  checkedPolicies: DatabasePolicies | undefined,
): MarkerSwapFailure {
  if (found?.storageHash !== expectedStorageHash) return { kind: 'storageHashMoved', found };
  if (checkedPolicies === undefined) return { kind: 'markerChanged', found };
  const comparison = compareMarkerDatabasePolicies(found, checkedPolicies);
  switch (comparison.kind) {
    case 'moved':
      return { kind: 'policiesMoved', found: comparison.found };
    case 'unreadable':
      return { kind: 'policiesUnreadable', why: comparison.why };
    case 'held':
      return { kind: 'markerChanged', found };
  }
}
