import {
  type Contract,
  type ContractModelBase,
  type ContractValueObject,
  profileHash,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';
import { normalizeRootSqlStorage } from './sql-storage-fixture';

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

export function createEmitterTestContract(
  overrides: Partial<Omit<Contract, 'storage'>> & {
    models?: Record<string, ContractModelBase> | undefined;
    valueObjects?: Record<string, ContractValueObject> | undefined;
    storage?: Record<string, unknown> | undefined;
  } = {},
): Contract {
  const { models, domain, storage, valueObjects, ...rest } = overrides;
  const normalizedStorage = Object.hasOwn(overrides, 'storage')
    ? normalizeRootSqlStorage(storage)
    : normalizeRootSqlStorage({ tables: {} });
  const resolvedStorage =
    valueObjects === undefined || normalizedStorage === undefined
      ? normalizedStorage
      : withValueObjects(normalizedStorage, valueObjects);
  const contract: Contract = {
    targetFamily: 'sql',
    target: 'test-db',
    roots: {},
    domain:
      domain ??
      applicationDomainOf({
        models: models ?? {},
        namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
      }),
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: profileHash('test'),
    ...rest,
    storage: resolvedStorage as Contract['storage'],
  };
  for (const [namespaceId, ns] of Object.entries(contract.domain.namespaces)) {
    for (const model of Object.values(ns.models ?? {})) {
      const storage = model.storage;
      if (
        storage !== null &&
        typeof storage === 'object' &&
        !Array.isArray(storage) &&
        !('namespaceId' in storage)
      ) {
        Object.assign(storage, { namespaceId });
      }
    }
  }
  return contract;
}
