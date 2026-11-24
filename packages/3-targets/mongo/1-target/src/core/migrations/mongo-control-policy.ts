import type { ContractWithDomain, ControlPolicy } from '@internal/contract/types';
import { collectionControlPoliciesOf, collectionControlPolicyOf } from '@internal/mongo-contract';

/** The control policy of `collection` as `contract` declares it. */
export function collectionControlPolicy(
  contract: ContractWithDomain,
  collection: string,
): ControlPolicy {
  return collectionControlPolicyOf(collection, collectionControlPoliciesOf(contract));
}

/** Whether the control policy is `managed` for collection `from` in the origin contract and collection `to` in the destination contract, as a rename between them needs. */
export function managedOnBothSides(
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
  change: { readonly from: string; readonly to: string },
): boolean {
  return (
    collectionControlPolicy(fromContract, change.from) === 'managed' &&
    collectionControlPolicy(contract, change.to) === 'managed'
  );
}
