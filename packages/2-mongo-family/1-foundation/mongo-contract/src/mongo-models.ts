import type { ApplicationDomain, ContractModel } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { MongoModelStorage } from './contract-types';

/** The models of namespace `namespaceId` of a validated MongoDB contract, whose storage records the stored name of every field. */
export function mongoModelsOf(
  domain: ApplicationDomain,
  namespaceId: string,
): Readonly<Record<string, ContractModel<MongoModelStorage>>> {
  return blindCast<
    Readonly<Record<string, ContractModel<MongoModelStorage>>>,
    'a validated MongoDB contract gives every model MongoDB model storage'
  >(domain.namespaces[namespaceId]?.models ?? {});
}

/** Model `modelName` followed by its base models, nearest first; empty when the model is not in `models`. */
export function modelAndBasesOf<Model extends Pick<ContractModel<MongoModelStorage>, 'base'>>(
  models: Readonly<Record<string, Model>>,
  modelName: string,
): readonly Model[] {
  const chain: Model[] = [];
  const seen = new Set<string>();
  for (let name: string | undefined = modelName; name !== undefined && !seen.has(name); ) {
    seen.add(name);
    const model: Model | undefined = models[name];
    if (model === undefined) break;
    chain.push(model);
    name = model.base?.model;
  }
  return chain;
}
