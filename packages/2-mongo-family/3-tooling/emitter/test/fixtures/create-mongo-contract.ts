import {
  type Contract,
  type ContractModelBase,
  type ContractValueObject,
  coreHash,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';

export function namespacedMongoStorageFromCollections(
  collections: Record<string, unknown>,
  storageHash = 'test',
) {
  return {
    storageHash: coreHash(storageHash),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'mongo-namespace' as const,
        entries: { collection: collections },
      },
    },
  } as Contract['storage'];
}

function withValueObjects(
  storage: Contract['storage'],
  valueObjects: Record<string, ContractValueObject>,
): Contract['storage'] {
  const namespace = storage.namespaces[UNBOUND_NAMESPACE_ID];
  return {
    ...storage,
    namespaces: {
      ...storage.namespaces,
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        ...namespace,
        entries: { ...namespace?.entries, valueObject: valueObjects },
      },
    },
  };
}

export function createMongoContract(
  overrides: Partial<Contract> & {
    models?: Record<string, ContractModelBase>;
    valueObjects?: Record<string, ContractValueObject>;
  } = {},
): Contract {
  const { models, domain, valueObjects, storage, ...rest } = overrides;
  const baseStorage = storage ?? namespacedMongoStorageFromCollections({});
  return {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    domain:
      domain ??
      applicationDomainOf({
        models: models ?? {},
        namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
      }),
    storage: valueObjects === undefined ? baseStorage : withValueObjects(baseStorage, valueObjects),
    extensions: {},
    capabilities: {},
    meta: {},
    roots: {},
    profileHash: 'test' as const,
    ...rest,
  } as Contract;
}
