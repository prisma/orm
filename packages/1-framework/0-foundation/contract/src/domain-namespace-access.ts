import { contractError } from './contract-errors';
import { soleDomainNamespaceId } from './default-namespace';
import type { ApplicationDomain } from './domain-envelope';
import type { ContractModelBase } from './domain-types';

/**
 * Models map for the contract's single domain namespace. Throws when the
 * contract does not declare exactly one namespace — bare-name access is
 * ambiguous across namespaces and must be qualified explicitly (TML-2550).
 */
export function domainModelsAtDefaultNamespace(
  domain: ApplicationDomain,
): Record<string, ContractModelBase> {
  const namespaceId = soleDomainNamespaceId(domain);
  const domainNamespace = domain.namespaces[namespaceId];
  if (domainNamespace === undefined) {
    throw contractError(
      'CONTRACT.NAMESPACE_INVALID',
      `domain namespace "${namespaceId}" is not present on the contract`,
      { meta: { reason: 'domain-namespace-missing', namespaceId } },
    );
  }
  return domainNamespace.models;
}
