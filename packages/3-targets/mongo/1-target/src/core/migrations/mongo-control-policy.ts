import {
  type Contract,
  type ContractWithDomain,
  type ControlPolicy,
  governingControlPolicy,
} from '@internal/contract/types';
import {
  collectionControlPoliciesOf,
  collectionControlPolicyOf,
  MongoCollection,
  type MongoContract,
} from '@internal/mongo-contract';

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

/** The control policy that governs a collection, and the policy its contract declares for it. */
export interface CollectionControl {
  readonly policy: ControlPolicy;
  readonly declared: ControlPolicy | undefined;
}

function declaredCollection(contract: Contract, collection: string): MongoCollection | undefined {
  return Object.values(contract.storage.namespaces)
    .map((namespace) => namespace.entries['collection']?.[collection])
    .find((entry) => entry instanceof MongoCollection);
}

/**
 * The control policy of `collection`. A collection the contract leaves out keeps the policy `fromContract` gave it, when that was not `managed`, so leaving an `external` collection out of the contract does not drop it.
 */
export function collectionControlOf(
  contract: MongoContract,
  fromContract: Contract | null,
  collection: string,
): CollectionControl {
  const declared = declaredCollection(contract, collection);
  const original =
    declared === undefined && fromContract !== null
      ? declaredCollection(fromContract, collection)
      : undefined;
  const policy = collectionControlPolicyOf(collection, collectionControlPoliciesOf(contract));
  if (original === undefined || fromContract === null) {
    return { policy, declared: declared?.control };
  }
  const originalPolicy = governingControlPolicy(
    { explicitNodeControlPolicy: original.control },
    fromContract.defaultControlPolicy,
  );
  return {
    policy: originalPolicy === 'managed' ? policy : originalPolicy,
    declared: original.control,
  };
}
