import type { ApplicationDomain, ContractModel } from '@internal/contract/types';
import type { MongoModelStorage } from './contract-types';
import { mongoModelsOf } from './mongo-models';
import { ownStoredNamesOf } from './stored-names';

/** A model of a contract's domain: its namespace and its name. */
export interface MongoModelReference {
  readonly namespaceId: string;
  readonly model: string;
}

/**
 * The collection a model's documents live in: its own, else its base's, else, for an embedded model,
 * its owner's. `undefined` when the model is missing or none of them names a collection.
 */
export function collectionOfModel(
  domain: ApplicationDomain,
  reference: MongoModelReference,
): string | undefined {
  const models = mongoModelsOf(domain, reference.namespaceId);
  const seen = new Set<string>();
  for (let name: string | undefined = reference.model; name !== undefined && !seen.has(name); ) {
    seen.add(name);
    const model: ContractModel<MongoModelStorage> | undefined = Object.hasOwn(models, name)
      ? models[name]
      : undefined;
    if (model === undefined) return undefined;
    const collection = model.storage['collection'];
    if (typeof collection === 'string') return collection;
    name = model.base?.model ?? model.owner;
  }
  return undefined;
}

/**
 * The field of a root model or a variant whose documents live in `collection` and that is stored
 * under `storedName`. An embedded model's fields are inside its owner's documents, not at their top.
 */
export function modelFieldStoredAs(
  domain: ApplicationDomain,
  collection: string,
  storedName: string,
): (MongoModelReference & { readonly field: string }) | undefined {
  for (const namespaceId of Object.keys(domain.namespaces)) {
    const models = mongoModelsOf(domain, namespaceId);
    for (const [model, definition] of Object.entries(models)) {
      if (definition.owner !== undefined) continue;
      if (collectionOfModel(domain, { namespaceId, model }) !== collection) continue;
      const field = Object.entries(ownStoredNamesOf(definition)).find(
        ([, stored]) => stored === storedName,
      )?.[0];
      if (field !== undefined) return { namespaceId, model, field };
    }
  }
  return undefined;
}
