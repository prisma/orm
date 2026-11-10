import {
  asNamespaceId,
  type ContractModelBase,
  type ContractWithDomain,
} from '@internal/contract/types';
import type { ModelCoordinate } from '@internal/framework-components/control';

function modelOf(
  contract: ContractWithDomain,
  coordinate: { readonly namespaceId: string; readonly model: string },
): ContractModelBase | undefined {
  const namespaces = contract.domain.namespaces;
  const namespace = Object.hasOwn(namespaces, coordinate.namespaceId)
    ? namespaces[coordinate.namespaceId]
    : undefined;
  return namespace !== undefined && Object.hasOwn(namespace.models, coordinate.model)
    ? namespace.models[coordinate.model]
    : undefined;
}

/** The discriminator value a variant has in its base model, or `undefined` when the model is no variant of the contract. */
export function variantValue(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): string | undefined {
  const base = modelOf(contract, coordinate)?.base;
  if (base === undefined) return undefined;
  const variants = modelOf(contract, { namespaceId: base.namespace, model: base.model })?.variants;
  return Object.entries(variants ?? {}).find(
    ([, variant]) =>
      variant.namespace === coordinate.namespaceId && variant.model === coordinate.model,
  )?.[0];
}

/** Whether a model is a variant in both contracts whose discriminator value changed between them. */
export function variantValueChanged(
  origin: ContractWithDomain,
  originModel: ModelCoordinate,
  destination: ContractWithDomain,
  destinationModel: ModelCoordinate,
): boolean {
  const from = variantValue(origin, originModel);
  const to = variantValue(destination, destinationModel);
  return from !== undefined && to !== undefined && from !== to;
}

/**
 * The variants a base model has in the destination and not in the origin, other than `renamedTo`:
 * the models a removed variant of that base can have been renamed to.
 */
export function newVariantsOfBase(
  origin: ContractWithDomain,
  destination: ContractWithDomain,
  variant: ModelCoordinate,
  renamedTo: readonly ModelCoordinate[],
): readonly ModelCoordinate[] {
  const base = modelOf(origin, variant)?.base;
  if (base === undefined) return [];
  const baseCoordinate = { namespaceId: base.namespace, model: base.model };
  const models = (contract: ContractWithDomain) =>
    Object.values(modelOf(contract, baseCoordinate)?.variants ?? {}).map((each) => ({
      namespaceId: each.namespace,
      model: each.model,
    }));
  const before = models(origin);
  const same =
    (left: { readonly namespaceId: string; readonly model: string }) =>
    (right: { readonly namespaceId: string; readonly model: string }) =>
      left.namespaceId === right.namespaceId && left.model === right.model;
  return models(destination)
    .filter((each) => !before.some(same(each)) && !renamedTo.some(same(each)))
    .map((each) => ({ ...each, namespaceId: asNamespaceId(each.namespaceId) }));
}
