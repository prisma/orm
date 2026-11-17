import { assertDefined } from '@internal/utils/assertions';
import { type CollectionControlPolicies, isManaged } from './collection-control-policies';
import { collectionRootModelsOf, type StoredModel } from './collection-root-models';
import {
  deriveModelJsonSchema,
  type ModelValidatorSources,
  type ValidatorModel,
  validatorOf,
} from './derive-json-schema';
import type { MongoValidator } from './ir/mongo-validator';

export type CollectionModel = ValidatorModel & StoredModel;

export interface CollectionValidatorsInput extends ModelValidatorSources {
  readonly models: Record<string, CollectionModel>;
  readonly controlPolicies: CollectionControlPolicies;
}

/**
 * The validator of each managed collection that stores a root model, keyed by collection name. A collection under another control policy holds documents Prisma does not own the shape of, so it gets none. A root model with variants gets one polymorphic schema covering every variant. A collection that stores several root models accepts a document of any of them: its schema has one `anyOf` branch per root model.
 */
export function deriveCollectionValidators(
  input: CollectionValidatorsInput,
): Record<string, MongoValidator> {
  const validators: Record<string, MongoValidator> = {};

  for (const [collectionName, modelNames] of Object.entries(collectionRootModelsOf(input.models))) {
    if (!isManaged(collectionName, input.controlPolicies)) continue;
    const schemas = modelNames.map((modelName) => {
      const model = input.models[modelName];
      assertDefined(
        model,
        `Root model "${modelName}" of collection "${collectionName}" is missing`,
      );
      return deriveModelJsonSchema(modelName, model, input);
    });
    const [only, ...others] = schemas;
    assertDefined(only, `Collection "${collectionName}" has no root model`);
    validators[collectionName] = validatorOf(
      others.length === 0 ? only : { bsonType: 'object', anyOf: schemas },
    );
  }

  return validators;
}
