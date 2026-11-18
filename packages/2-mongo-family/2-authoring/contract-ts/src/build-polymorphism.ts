import type { ContractEnum, JsonValue } from '@internal/contract/types';
import {
  applyDiscriminatorRule,
  type DataTypeSupport,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import type { BuildRefusal } from './build-refusals';
import type { ModelNode } from './contract-definition';

/**
 * The models with each variant stored in its base's collection: a variant that names no collection takes its base's, and one that names another is refused.
 */
export function inheritVariantCollections(
  models: readonly ModelNode[],
  refusals: BuildRefusal[],
): readonly ModelNode[] {
  const modelsByName = new Map(models.map((model) => [model.modelName, model]));
  return models.map((model) => {
    if (model.base === undefined) return model;
    const baseCollection = modelsByName.get(model.base.model)?.collection;
    if (baseCollection === undefined) return model;
    if (model.collection === undefined) return { ...model, collection: baseCollection };
    if (model.collection !== baseCollection) {
      refusals.push({
        kind: 'variantCollectionDiffers',
        key: { kind: 'collectionSettings', model: model.modelName },
        collection: model.collection,
        baseModel: model.base.model,
        baseCollection,
      });
    }
    return model;
  });
}

function checkVariantShape(
  model: ModelNode,
  modelsByName: ReadonlyMap<string, ModelNode>,
  refusals: BuildRefusal[],
): void {
  if (model.base === undefined) return;
  const key = { kind: 'base', variant: model.modelName } as const;
  const baseModel = model.base.model;
  if (model.discriminator !== undefined) {
    refusals.push({
      kind: 'discriminatorAndBase',
      key: { kind: 'discriminator', model: model.modelName },
    });
  }
  const base = modelsByName.get(baseModel);
  if (base === undefined) {
    refusals.push({ kind: 'baseUnknown', key, baseModel });
    return;
  }
  if (base.discriminator === undefined) {
    refusals.push({ kind: 'baseWithoutDiscriminator', key, baseModel });
    return;
  }
  if (model.base.value === undefined) {
    refusals.push({ kind: 'variantWithoutValue', key, baseModel });
  }
}

/** Each variant of `base` with the value its source wrote, in the order of the models. */
function writtenVariantsOf(
  base: ModelNode,
  models: readonly ModelNode[],
): readonly { readonly key: string; readonly written: WrittenValue }[] {
  return models.flatMap((model) =>
    model.base?.model === base.modelName && model.base.value !== undefined
      ? [{ key: model.modelName, written: model.base.value }]
      : [],
  );
}

function decideDiscriminator(input: {
  readonly base: ModelNode;
  readonly models: readonly ModelNode[];
  readonly enums: Readonly<Record<string, ContractEnum>>;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
  readonly refusals: BuildRefusal[];
}): ReadonlyMap<string, string> {
  const { base, models, refusals } = input;
  const discriminator = base.discriminator;
  if (discriminator === undefined || base.base !== undefined) return new Map();
  const key = { kind: 'discriminator', model: base.modelName } as const;
  const variantNames = new Set(
    models.filter((model) => model.base?.model === base.modelName).map((model) => model.modelName),
  );
  for (const listed of discriminator.listedVariants ?? []) {
    if (!variantNames.has(listed)) {
      refusals.push({ kind: 'listedVariantMissing', key, variant: listed });
    }
  }
  if (variantNames.size === 0) {
    refusals.push({ kind: 'discriminatorWithoutVariants', key });
  }
  const fieldName = discriminator.field;
  const field = base.fields.find((candidate) => candidate.fieldName === fieldName);
  if (field === undefined) {
    refusals.push({ kind: 'discriminatorFieldUnknown', key, fieldName });
    return new Map();
  }
  const { type } = field;
  const enumMembers =
    field.enumName === undefined
      ? undefined
      : input.enums[field.enumName]?.members.map((member) => member.value);
  const decision = applyDiscriminatorRule({
    field: {
      ref:
        type.kind === 'scalar'
          ? {
              codecId: type.codecId,
              ...(type.typeParams
                ? {
                    typeParams: blindCast<
                      JsonValue,
                      'a field type holds its type parameters as the contract stores them, as JSON'
                    >(type.typeParams),
                  }
                : {}),
            }
          : undefined,
      nullable: field.nullable,
      many: field.many !== false,
      enumMembers,
    },
    variants: writtenVariantsOf(base, models),
    subject: `Field "${base.modelName}.${fieldName}"`,
    codecLookup: input.codecLookup,
    dataTypes: input.dataTypes,
  });
  for (const refusal of decision.fieldRefusals) {
    refusals.push({ kind: 'discriminatorField', key, fieldName, refusal });
  }
  for (const refusal of decision.variantRefusals) {
    refusals.push({
      kind: 'discriminatorValue',
      key: { kind: 'base', variant: refusal.key },
      baseModel: base.modelName,
      fieldName,
      enumName: field.enumName,
      refusal,
    });
  }
  const variantsByValue = new Map<string, string>();
  for (const [variant, value] of decision.values) {
    const firstVariant = variantsByValue.get(value);
    if (firstVariant !== undefined) {
      refusals.push({
        kind: 'discriminatorValueDuplicate',
        key: { kind: 'base', variant },
        baseModel: base.modelName,
        value,
        firstVariant,
      });
      continue;
    }
    variantsByValue.set(value, variant);
  }
  return decision.values;
}

/**
 * Checks each base and variant, and decides each variant's discriminator value with the framework's discriminator rule. Returns each accepted variant's value as its base's discriminator field stores it.
 */
export function decidePolymorphism(input: {
  readonly models: readonly ModelNode[];
  readonly enums: Readonly<Record<string, ContractEnum>>;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
  readonly refusals: BuildRefusal[];
}): ReadonlyMap<string, string> {
  const { models, refusals } = input;
  const modelsByName = new Map(models.map((model) => [model.modelName, model]));
  const values = new Map<string, string>();
  for (const model of models) {
    checkVariantShape(model, modelsByName, refusals);
    for (const [variant, value] of decideDiscriminator({ ...input, base: model })) {
      values.set(variant, value);
    }
  }
  return values;
}
