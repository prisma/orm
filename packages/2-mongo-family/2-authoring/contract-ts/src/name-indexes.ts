import { defaultIndexNameOf } from './build-collections';
import type { ContractDefinition, IndexNode, ModelNode } from './contract-definition';

function namedIndex(index: IndexNode, model: ModelNode): IndexNode {
  if (index.options?.name !== undefined) return index;
  return { ...index, options: { ...index.options, name: defaultIndexNameOf(index, model.fields) } };
}

/**
 * Names each index the definition writes without a name as MongoDB names an index created without one: its stored keys and directions, such as `email_1`. The Prisma 8 authoring sources call it before `mergeRedundantIndexes` and the builder. Two indexes of one collection that get one name are left for the builder to refuse.
 */
export function nameIndexes(definition: ContractDefinition): ContractDefinition {
  return {
    ...definition,
    models: definition.models.map((model) =>
      model.indexes === undefined
        ? model
        : { ...model, indexes: model.indexes.map((index) => namedIndex(index, model)) },
    ),
  };
}
