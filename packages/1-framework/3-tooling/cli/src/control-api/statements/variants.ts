import type { ContractModelBase, ContractWithDomain } from '@internal/contract/types';
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
