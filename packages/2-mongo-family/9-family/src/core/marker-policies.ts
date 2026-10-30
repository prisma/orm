import type { ContractMarkerRecord } from '@internal/contract/types';
import {
  compareMarkerDatabasePolicies,
  DATABASE_POLICIES_META_KEY,
  type DatabasePolicies,
  type MarkerDatabasePoliciesComparison,
} from '@internal/framework-components/control';
import type { CheckedMarkerPolicies } from './control-adapter';

/** How the policies the application space's marker records compare with `checked`; when they hold, the raw value to guard its write with. */
export type MarkerPoliciesCheck =
  | { readonly kind: 'held'; readonly policies: CheckedMarkerPolicies }
  | Exclude<MarkerDatabasePoliciesComparison, { readonly kind: 'held' }>;

export function checkMarkerPolicies(
  marker: ContractMarkerRecord | null,
  checked: DatabasePolicies,
): MarkerPoliciesCheck {
  const comparison = compareMarkerDatabasePolicies(marker, checked);
  if (comparison.kind !== 'held') return comparison;
  return {
    kind: 'held',
    policies: { checked, raw: { value: marker?.meta[DATABASE_POLICIES_META_KEY] } },
  };
}
