import {
  type ContractModelBase,
  crossRef,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';

function normalizeModels(
  models: Record<string, ContractModelBase>,
): Record<string, ContractModelBase> {
  return Object.fromEntries(
    Object.entries(models).map(([name, model]) => [
      name,
      { ...model, relations: model.relations ?? {} },
    ]),
  ) as Record<string, ContractModelBase>;
}

export function mongoContractJson(params: {
  readonly models?: Record<string, ContractModelBase>;
  readonly storageCollections?: Record<string, unknown>;
  readonly roots?: Record<string, ReturnType<typeof crossRef>>;
}) {
  const models = normalizeModels(
    (params.models ?? {
      Item: {
        fields: {
          _id: {
            type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            nullable: false,
            many: false,
          },
        },
        storage: { collection: 'items' },
      },
    }) as Record<string, ContractModelBase>,
  );
  const collections = params.storageCollections ?? { items: {} };
  return {
    targetFamily: 'mongo',
    target: 'mongo',
    profileHash: 'test',
    roots: params.roots ?? { items: crossRef('Item') },
    domain: applicationDomainOf({ models, namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID }),
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { collection: collections },
        },
      },
    },
  };
}
