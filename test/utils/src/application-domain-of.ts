import {
  type ApplicationDomain,
  type ContractModelBase,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';

export function applicationDomainOf(params: {
  readonly models?: Record<string, ContractModelBase>;
  readonly namespaceId?: string;
}): ApplicationDomain {
  const namespaceId = params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  return { namespaces: { [namespaceId]: { models: params.models ?? {} } } };
}
