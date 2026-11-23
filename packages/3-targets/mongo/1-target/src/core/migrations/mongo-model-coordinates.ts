import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type { ModelCoordinate } from '@internal/framework-components/control';

export function modelCoordinates(contract: ContractWithDomain): readonly ModelCoordinate[] {
  return Object.entries(contract.domain?.namespaces ?? {}).flatMap(([namespaceId, namespace]) =>
    Object.keys(namespace.models).map((model) => ({
      namespaceId: asNamespaceId(namespaceId),
      model,
    })),
  );
}

export function sameModel(a: ModelCoordinate, b: ModelCoordinate): boolean {
  return a.namespaceId === b.namespaceId && a.model === b.model;
}
