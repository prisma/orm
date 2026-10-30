import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { indexLookupKey } from '@internal/mongo-contract';
import { checkModelIndexes } from './build-collections';
import { buildEnums } from './build-enums';
import { decidePolymorphism, inheritVariantCollections } from './build-polymorphism';
import type { BuildRefusal } from './build-refusals';
import type { ContractDefinition, ModelNode } from './contract-definition';

/** An index the merge removed: the model that wrote it and its position in that model's indexes as written. */
export interface RemovedIndex {
  readonly model: string;
  readonly position: number;
}

/** The definition without its identical and redundant indexes, and which indexes were removed. */
export interface MergedIndexes {
  readonly definition: ContractDefinition;
  readonly removedIndexes: readonly RemovedIndex[];
}

interface HeldIndex extends RemovedIndex {
  readonly lookupKey: string;
  readonly unique: boolean;
}

function positionKey({ model, position }: RemovedIndex): string {
  return JSON.stringify([model, position]);
}

/**
 * Removes each identical or redundant index in a collection, for the Prisma 8 authoring sources to call before the builder. Two indexes match when their storage indexes, variant scope applied, have the same `indexLookupKey` with `unique` left out. Of a matching pair the first is kept, unless only the later one is unique; then the later one is kept and the earlier removed. Indexes the builder refuses are left for it to refuse. A source that reports the builder's refusals by index position maps them back through `removedIndexes`.
 */
export function mergeRedundantIndexes(
  definition: ContractDefinition,
  codecLookup: CodecLookupWithDescriptors,
  dataTypes: DataTypeSupport,
): MergedIndexes {
  const refusalsLeftToTheBuilder: BuildRefusal[] = [];
  const models = inheritVariantCollections(definition.models, refusalsLeftToTheBuilder);
  const variantValues = decidePolymorphism({
    models,
    enums: buildEnums(definition, codecLookup, refusalsLeftToTheBuilder),
    codecLookup,
    dataTypes,
    refusals: refusalsLeftToTheBuilder,
  });
  const modelsByName = new Map(models.map((model) => [model.modelName, model]));
  const heldByCollection = new Map<string, HeldIndex[]>();
  const removedIndexes: RemovedIndex[] = [];

  for (const model of models) {
    const { collection } = model;
    if (!collection) continue;
    const held = heldByCollection.get(collection) ?? [];
    heldByCollection.set(collection, held);
    checkModelIndexes(model, modelsByName, variantValues).forEach((checked, position) => {
      if (checked.kind === 'refused') return;
      const index: HeldIndex = {
        model: model.modelName,
        position,
        lookupKey: indexLookupKey({ ...checked.index, unique: undefined }),
        unique: checked.index.unique === true,
      };
      const matchingAt = held.findIndex((candidate) => candidate.lookupKey === index.lookupKey);
      const match = held[matchingAt];
      if (match !== undefined) {
        if (match.unique || !index.unique) {
          removedIndexes.push({ model: index.model, position: index.position });
          return;
        }
        removedIndexes.push({ model: match.model, position: match.position });
        held.splice(matchingAt, 1);
      }
      held.push(index);
    });
  }

  if (removedIndexes.length === 0) return { definition, removedIndexes };
  const removed = new Set(removedIndexes.map(positionKey));
  const withoutRemoved = (model: ModelNode): ModelNode =>
    model.indexes === undefined
      ? model
      : {
          ...model,
          indexes: model.indexes.filter(
            (_, position) => !removed.has(positionKey({ model: model.modelName, position })),
          ),
        };
  return {
    definition: { ...definition, models: definition.models.map(withoutRemoved) },
    removedIndexes,
  };
}
