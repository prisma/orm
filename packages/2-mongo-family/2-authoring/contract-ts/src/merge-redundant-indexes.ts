import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { indexLookupKey } from '@internal/mongo-contract';
import {
  findMissingIndexField,
  indexShapeProblem,
  resolveVariantScope,
  scopedStorageIndex,
} from './build-collections';
import { buildEnums } from './build-enums';
import { decidePolymorphism, inheritVariantCollections } from './build-polymorphism';
import type { BuildRefusal } from './build-refusals';
import type { ContractDefinition, ModelNode } from './contract-definition';

interface HeldIndex {
  readonly model: string;
  readonly position: number;
  readonly lookupKey: string;
  readonly unique: boolean;
}

function positionKey(model: string, position: number): string {
  return JSON.stringify([model, position]);
}

/**
 * The definition with each identical or redundant index in a collection removed, for the Prisma 8 authoring sources to call before the builder. Two indexes match when their storage indexes, variant scope applied, have the same `indexLookupKey` with `unique` left out. Of a matching pair the first is kept, unless only the later one is unique; then the later one is kept and the earlier removed. Indexes the builder refuses are left for it to refuse.
 */
export function mergeRedundantIndexes(
  definition: ContractDefinition,
  codecLookup: CodecLookupWithDescriptors,
  dataTypes: DataTypeSupport,
): ContractDefinition {
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
  const removed = new Set<string>();

  for (const model of models) {
    const { collection } = model;
    if (!collection) continue;
    const held = heldByCollection.get(collection) ?? [];
    heldByCollection.set(collection, held);
    const scope = resolveVariantScope(model, modelsByName, variantValues);
    (model.indexes ?? []).forEach((written, position) => {
      if (findMissingIndexField(written, model.fields) !== undefined) return;
      if (indexShapeProblem(written) !== undefined) return;
      const scoped = scopedStorageIndex(written, model.fields, scope);
      if (scoped.kind === 'conflict') return;
      const index: HeldIndex = {
        model: model.modelName,
        position,
        lookupKey: indexLookupKey({ ...scoped.index, unique: undefined }),
        unique: scoped.index.unique === true,
      };
      const matchingAt = held.findIndex((candidate) => candidate.lookupKey === index.lookupKey);
      const match = held[matchingAt];
      if (match !== undefined) {
        if (match.unique || !index.unique) {
          removed.add(positionKey(index.model, index.position));
          return;
        }
        removed.add(positionKey(match.model, match.position));
        held.splice(matchingAt, 1);
      }
      held.push(index);
    });
  }

  if (removed.size === 0) return definition;
  const withoutRemoved = (model: ModelNode): ModelNode =>
    model.indexes === undefined
      ? model
      : {
          ...model,
          indexes: model.indexes.filter(
            (_, position) => !removed.has(positionKey(model.modelName, position)),
          ),
        };
  return { ...definition, models: definition.models.map(withoutRemoved) };
}
