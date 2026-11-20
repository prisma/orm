import { type ControlPolicy, governingControlPolicy } from '@internal/contract/types';

/** The control policy each collection declares, and the contract's default. */
export interface CollectionControlPolicies {
  readonly collections: Readonly<Record<string, ControlPolicy | undefined>>;
  readonly defaultControlPolicy: ControlPolicy | undefined;
}

/** The control policies a built contract declares for its collections. */
export function collectionControlPoliciesOf(contract: {
  readonly storage: {
    readonly namespaces: Readonly<
      Record<
        string,
        {
          readonly entries: {
            readonly collection?: Readonly<Record<string, { readonly control?: ControlPolicy }>>;
          };
        }
      >
    >;
  };
  readonly defaultControlPolicy?: ControlPolicy | undefined;
}): CollectionControlPolicies {
  return {
    collections: Object.fromEntries(
      Object.values(contract.storage.namespaces).flatMap((namespace) =>
        Object.entries(namespace.entries.collection ?? {}).map(([name, collection]) => [
          name,
          collection.control,
        ]),
      ),
    ),
    defaultControlPolicy: contract.defaultControlPolicy,
  };
}

/** The control policy that governs `collection`, with the `external` default as a floor, as the planner, the validator derivation and the verifier all read it. */
export function collectionControlPolicyOf(
  collection: string,
  policies: CollectionControlPolicies,
): ControlPolicy {
  return governingControlPolicy(
    { explicitNodeControlPolicy: policies.collections[collection] },
    policies.defaultControlPolicy,
  );
}

/** Whether `collection` is managed, so it gets a validator. */
export function isManaged(collection: string, policies: CollectionControlPolicies): boolean {
  return collectionControlPolicyOf(collection, policies) === 'managed';
}
