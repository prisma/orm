import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type { ModelCoordinate } from '@internal/framework-components/control';
import { collectionOfModel, embeddingModelOf, mongoModelsOf } from '@internal/mongo-contract';

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

/** Whether `model` is a root model of `contract`: it has no base model. */
export function isRootModel(contract: ContractWithDomain, model: ModelCoordinate): boolean {
  return mongoModelsOf(contract.domain, model.namespaceId)[model.model]?.base === undefined;
}

/** The collection whose top-level documents are the model's: `undefined` for an embedded model or one with no collection. */
export function documentCollectionOf(
  contract: ContractWithDomain,
  model: ModelCoordinate,
): string | undefined {
  return embeddingModelOf(contract.domain, model) === undefined
    ? collectionOfModel(contract.domain, model)
    : undefined;
}

/** The root model of `model`: itself for a root model, else the root its bases lead to. */
export function rootModelOf(contract: ContractWithDomain, model: ModelCoordinate): ModelCoordinate {
  const models = mongoModelsOf(contract.domain, model.namespaceId);
  const seen = new Set<string>();
  let current = model.model;
  for (let base = models[current]?.base; base !== undefined; base = models[current]?.base) {
    if (seen.has(current)) break;
    seen.add(current);
    current = base.model;
  }
  return { namespaceId: model.namespaceId, model: current };
}
