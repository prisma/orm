import type { ApplicationDomain } from './domain-envelope';
import type { ContractModelBase } from './domain-types';

export interface ResolvedDomainModel {
  readonly namespaceId: string;
  readonly model: ContractModelBase;
}

/**
 * Resolve a bare domain model name to its namespace coordinate and model IR by
 * scanning the contract's namespaces. For the single-namespace contracts in
 * scope the scan is exact; cross-namespace bare-name collisions are selected
 * explicitly (TML-2550).
 */
export function resolveDomainModel(
  domain: ApplicationDomain,
  modelName: string,
): ResolvedDomainModel | undefined {
  for (const [namespaceId, namespace] of Object.entries(domain.namespaces)) {
    const model = Object.hasOwn(namespace.models, modelName)
      ? namespace.models[modelName]
      : undefined;
    if (model !== undefined) {
      return { namespaceId, model };
    }
  }

  return undefined;
}
