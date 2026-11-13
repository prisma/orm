import type { ApplicationDomain, ContractModel } from '@internal/contract/types';
import { collectionRootModelsOf } from './collection-root-models';
import type { MongoModelStorage } from './contract-types';
import type { MongoModelReference } from './model-collections';
import { modelAndBasesOf, mongoModelsOf } from './mongo-models';
import { hasOwnFieldStoredAs, ownEmbedStoredNamesOf, ownStoredNameOf } from './stored-names';

type Document = Readonly<Record<string, unknown>>;

function modelOf(
  models: Readonly<Record<string, ContractModel<MongoModelStorage>>>,
  name: string,
): ContractModel<MongoModelStorage> | undefined {
  return Object.hasOwn(models, name) ? models[name] : undefined;
}

/**
 * The filter that selects a variant's documents in its collection: its base's discriminator, under
 * its stored name, holding the variant's value. `undefined` for a root model.
 */
export function variantFilterOf(
  domain: ApplicationDomain,
  reference: MongoModelReference,
): Document | undefined {
  const models = mongoModelsOf(domain, reference.namespaceId);
  const base = modelOf(models, reference.model)?.base;
  if (base === undefined) return undefined;
  const baseModel = modelOf(mongoModelsOf(domain, base.namespace), base.model);
  const field = baseModel?.discriminator?.field;
  const value = Object.entries(baseModel?.variants ?? {}).find(
    ([, variant]) =>
      variant.namespace === reference.namespaceId && variant.model === reference.model,
  )?.[0];
  return baseModel === undefined || field === undefined || value === undefined
    ? undefined
    : { [ownStoredNameOf(baseModel, field)]: value };
}

/** The discriminator field and value a variant's filter selects; `undefined` for any other filter. */
function discriminatorValueOf(
  filter: Document | undefined,
): { readonly field: string; readonly value: unknown } | undefined {
  const entries = Object.entries(filter ?? {});
  if (entries.length !== 1) return undefined;
  const [entry] = entries;
  if (entry === undefined) return undefined;
  const [field, value] = entry;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? { field, value }
    : undefined;
}

/** Whether one of `model`'s own fields or embed relations is stored under `storedName`. */
function ownStores(model: ContractModel<MongoModelStorage>, storedName: string): boolean {
  return (
    hasOwnFieldStoredAs(model, storedName) ||
    Object.values(ownEmbedStoredNamesOf(model)).includes(storedName)
  );
}

/**
 * The other models stored in `collection`, root models and their variants, whose documents a change
 * of `storedName` with `filter` reaches, and which store the field themselves or through their base;
 * with no `storedName`, every such model, whether it stores the field or not. No discriminator tells
 * the documents of several root models apart, so without a filter, or with a base model's filter,
 * every other root model's documents are reached. A variant's filter, one discriminator value,
 * reaches a model only when its documents can hold that value: a variant of another root model with
 * the same discriminator field and value, or a model that declares the discriminator field itself.
 */
export function otherModelsReached(
  domain: ApplicationDomain,
  reference: MongoModelReference,
  collection: string,
  filter: Document | undefined,
  storedName: string | undefined,
): readonly string[] {
  const models = mongoModelsOf(domain, reference.namespaceId);
  const baseOf = (name: string) => {
    const base = modelOf(models, name)?.base;
    return base === undefined ? undefined : modelOf(models, base.model);
  };
  const storesOrInherits = (name: string, stored: string) =>
    modelAndBasesOf(models, name).some((each) => ownStores(each, stored));
  const selected = discriminatorValueOf(filter);
  const canHold = (name: string) => {
    if (selected === undefined) return true;
    const base = baseOf(name);
    const discriminator = base?.discriminator?.field;
    if (
      base !== undefined &&
      discriminator !== undefined &&
      ownStoredNameOf(base, discriminator) === selected.field
    ) {
      return Object.entries(base.variants ?? {}).some(
        ([value, variant]) => variant.model === name && value === selected.value,
      );
    }
    return storesOrInherits(name, selected.field);
  };
  const subjectRoot = modelOf(models, reference.model)?.base?.model ?? reference.model;
  return (collectionRootModelsOf(models)[collection] ?? [])
    .filter((name) => name !== subjectRoot)
    .flatMap((name) => [
      name,
      ...Object.values(modelOf(models, name)?.variants ?? {}).map((variant) => variant.model),
    ])
    .filter(
      (name) => canHold(name) && (storedName === undefined || storesOrInherits(name, storedName)),
    );
}
