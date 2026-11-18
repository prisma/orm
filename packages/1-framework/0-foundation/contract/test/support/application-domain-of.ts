import type { ApplicationDomain } from '../../src/domain-envelope';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '../../src/domain-envelope';
import type { ContractModelBase } from '../../src/domain-types';

/**
 * Single-namespace application-domain authoring convenience for this package's
 * own tests. The shared copy lives in `@repo/test-utils`, but the
 * foundation `contract` package cannot depend on test-utils (test-utils depends
 * on contract), so the helper is duplicated here to keep package boundaries
 * one-way.
 */
export function applicationDomainOf(params: {
  readonly models?: Record<string, ContractModelBase>;
  readonly namespaceId?: string;
}): ApplicationDomain {
  const namespaceId = params.namespaceId ?? UNBOUND_DOMAIN_NAMESPACE_ID;
  const models = params.models ?? {};
  return {
    namespaces: {
      [namespaceId]: { models },
    },
  };
}
