import type { ContractModel, ContractRelation } from '@internal/contract/types';
import { validateStorageValueObjects } from '@internal/contract/validate-storage';
import { structuredError } from '@internal/utils/structured-error';
import { collectionRootModelsOf } from './collection-root-models';
import { lookupFreeRefusalsOf } from './contract-refusals';
import type { MongoContract, MongoModelStorage } from './contract-types';
import { documentIdRefusalOf } from './document-id-refusal';
import { modelAndBasesOf, mongoModelsOf } from './mongo-models';
import { resolveMongoToOneRelationFields } from './relation-fields';
import {
  ownDocumentIdFieldOf,
  ownEmbedStoredNamesOf,
  ownStoredNamesOf,
  unsupportedStoredNameReason,
} from './stored-names';
import { type ValidatorShape, validatorRootShapesOf } from './validator-shapes';

function bsonTypesOf(schema: object): readonly string[] {
  if (!('bsonType' in schema)) return [];
  const { bsonType } = schema;
  const types: readonly unknown[] = Array.isArray(bsonType) ? bsonType : [bsonType];
  return types.filter((type): type is string => typeof type === 'string');
}

function idSchemaOf(shape: ValidatorShape): object | undefined {
  const id = shape.properties['_id'];
  return shape.required.includes('_id') && typeof id === 'object' && id !== null ? id : undefined;
}

/**
 * What a collection validator gets wrong about `_id`: a root model's branch that does not require it, or an `_id` that can hold a BSON type an `_id` cannot have, refused with the reason the build gives.
 */
function documentIdErrors(contract: MongoContract): string[] {
  const models: Record<string, ContractModel<MongoModelStorage>> = Object.assign(
    {},
    ...Object.keys(contract.domain.namespaces).map((namespaceId) =>
      mongoModelsOf(contract.domain, namespaceId),
    ),
  );
  const rootModels = collectionRootModelsOf(models);
  return Object.values(contract.storage.namespaces).flatMap((namespace) =>
    Object.entries(namespace.entries['collection'] ?? {}).flatMap(([name, collection]) => {
      if (collection.validator === undefined) return [];
      const shapes = validatorRootShapesOf(collection.validator.jsonSchema);
      const idSchemas = shapes.map(idSchemaOf);
      if (shapes.length === 0 || idSchemas.includes(undefined)) {
        return [
          `Collection "${name}": its validator must require _id, for every model the collection stores, since every document has an _id`,
        ];
      }
      const names = rootModels[name] ?? [];
      return idSchemas.flatMap((idSchema, index): string[] => {
        const modelName = names.length === shapes.length ? names[index] : undefined;
        const model = modelName === undefined ? undefined : models[modelName];
        const id = model === undefined ? undefined : ownDocumentIdFieldOf(model);
        const codecId = id?.field.type.kind === 'scalar' ? id.field.type.codecId : 'unknown';
        const refusal =
          idSchema === undefined ? undefined : documentIdRefusalOf(codecId, bsonTypesOf(idSchema));
        if (refusal === undefined) return [];
        return [
          id === undefined
            ? `Collection "${name}": its validator's _id ${refusal.reason}`
            : `Model "${modelName}" field "${id.name}" ${refusal.reason}`,
        ];
      });
    }),
  );
}

function formatCrossRef(crossRef: { readonly namespace: string; readonly model: string }): string {
  return `${crossRef.namespace}.${crossRef.model}`;
}

function storageDeclaresCollection(
  storage: MongoContract['storage'],
  collectionName: string,
): boolean {
  for (const ns of Object.values(storage.namespaces)) {
    if (Object.hasOwn(ns.entries['collection'] ?? {}, collectionName)) {
      return true;
    }
  }
  return false;
}

function fieldStorageErrors(
  qualifiedName: string,
  modelName: string,
  model: ContractModel<MongoModelStorage>,
  models: Record<string, ContractModel<MongoModelStorage>>,
): string[] {
  const errors: string[] = [];
  const storageFields = model.storage.fields;
  for (const fieldName of Object.keys(model.fields)) {
    if (!Object.hasOwn(storageFields, fieldName)) {
      errors.push(`Model "${qualifiedName}" field "${fieldName}" has no entry in storage.fields`);
    }
  }
  for (const fieldName of Object.keys(storageFields)) {
    if (!Object.hasOwn(model.fields, fieldName)) {
      errors.push(
        `Model "${qualifiedName}" storage.fields names "${fieldName}", which is not a field of the model`,
      );
    }
  }
  errors.push(...unsupportedStoredNameErrors(qualifiedName, model));
  if (errors.length > 0) return errors;
  const chain = [...modelAndBasesOf(models, modelName)].reverse();
  if (!chain.every(hasCompleteFieldStorage)) return errors;
  const membersByStoredName = new Map<string, string>();
  const members = chain.flatMap((each) => [
    ...Object.entries(ownStoredNamesOf(each)).map(
      ([name, storedName]) => [`field "${name}"`, storedName] as const,
    ),
    ...Object.entries(ownEmbedStoredNamesOf(each)).map(
      ([name, storedName]) => [`embed relation "${name}"`, storedName] as const,
    ),
  ]);
  for (const [member, storedName] of members) {
    const other = membersByStoredName.get(storedName);
    if (other !== undefined && other !== member) {
      errors.push(bothStoredAs(qualifiedName, other, member, storedName));
    }
    membersByStoredName.set(storedName, member);
  }
  return errors;
}

function unsupportedStoredNameErrors(
  qualifiedName: string,
  model: ContractModel<MongoModelStorage>,
): string[] {
  const members = [
    ...Object.entries(model.storage.fields).map(
      ([name, { field }]) => [`field "${name}"`, field] as const,
    ),
    ...Object.entries(model.storage.relations ?? {}).map(
      ([name, { field }]) => [`embed relation "${name}"`, field] as const,
    ),
  ];
  return members.flatMap(([member, storedName]) => {
    const reason = unsupportedStoredNameReason(storedName);
    return reason === undefined ? [] : [`Model "${qualifiedName}" ${member} ${reason}`];
  });
}

function hasCompleteFieldStorage(model: ContractModel<MongoModelStorage>): boolean {
  return Object.keys(model.fields).every((name) => Object.hasOwn(model.storage.fields, name));
}

function bothStoredAs(
  qualifiedName: string,
  first: string,
  second: string,
  storedName: string,
): string {
  const fieldPrefix = 'field "';
  if (first.startsWith(fieldPrefix) && second.startsWith(fieldPrefix)) {
    const [a, b] = [first, second].map((member) => member.slice(fieldPrefix.length, -1)).sort();
    return `Model "${qualifiedName}" fields "${a}" and "${b}" are both stored as "${storedName}"`;
  }
  return `Model "${qualifiedName}" ${first} and ${second} are both stored as "${storedName}"`;
}

export function validateMongoStorage(contract: MongoContract): void {
  validateStorageValueObjects(contract.storage);
  const errors: string[] = [];
  let fieldStorageComplete = true;

  for (const namespaceId of Object.keys(contract.domain.namespaces)) {
    const models = mongoModelsOf(contract.domain, namespaceId);
    for (const [modelName, model] of Object.entries(models)) {
      const qualifiedName = `${namespaceId}:${modelName}`;
      const fieldErrors = fieldStorageErrors(qualifiedName, modelName, model, models);
      if (fieldErrors.length > 0) fieldStorageComplete = false;
      errors.push(...fieldErrors);
      if (
        model.storage.collection &&
        !storageDeclaresCollection(contract.storage, model.storage.collection)
      ) {
        errors.push(
          `Model "${qualifiedName}" references collection "${model.storage.collection}" which is not declared under any namespace's collections map`,
        );
      }

      if (model.base) {
        const baseModel = models[model.base.model];
        if (baseModel) {
          const variantCollection = model.storage.collection;
          const baseCollection = baseModel.storage.collection;
          if (variantCollection !== baseCollection) {
            errors.push(
              `Mongo does not support multi-table inheritance; variant "${qualifiedName}" must share its base's collection ("${baseCollection ?? '(none)'}"), but has "${variantCollection ?? '(none)'}"`,
            );
          }
        }
      }

      for (const [relName, relation] of Object.entries(model.relations ?? {})) {
        const targetModel = models[relation.to.model];
        const targetLabel = formatCrossRef(relation.to);

        if (targetModel?.owner) {
          if (targetModel.owner !== modelName) {
            errors.push(
              `Embed relation "${relName}" targets "${targetLabel}" which is owned by "${targetModel.owner}", not "${qualifiedName}"`,
            );
          }
          if (targetModel.storage.collection) {
            errors.push(
              `Embed relation "${relName}" targets "${targetLabel}" which must not have a collection`,
            );
          }
        } else if ('on' in relation && relation.on) {
          for (const localField of relation.on.localFields) {
            if (!(localField in model.fields)) {
              errors.push(
                `Reference relation "${relName}": localField "${localField}" is not a field on model "${qualifiedName}"`,
              );
            }
          }

          if (targetModel) {
            for (const targetField of relation.on.targetFields) {
              if (!(targetField in targetModel.fields)) {
                errors.push(
                  `Reference relation "${relName}": targetField "${targetField}" is not a field on model "${targetLabel}"`,
                );
              }
            }
          }

          const nullabilityError =
            fieldErrors.length > 0
              ? undefined
              : toOneRelationNullabilityError(qualifiedName, relName, relation, model);
          if (nullabilityError !== undefined) errors.push(nullabilityError);
        }
      }
    }
  }

  for (const namespace of Object.values(contract.domain.namespaces)) {
    for (const refusal of lookupFreeRefusalsOf(namespace.models)) {
      if (refusal.kind === 'embeddedModelHasVariants') {
        errors.push(`Relation "${refusal.modelName}.${refusal.relationName}" ${refusal.reason}`);
      }
    }
  }
  if (fieldStorageComplete) errors.push(...documentIdErrors(contract));

  if (errors.length > 0) {
    throw structuredError(
      'CONTRACT.VALIDATION_FAILED',
      `Contract storage validation failed:\n- ${errors.join('\n- ')}`,
    );
  }
}

/**
 * A same-space to-one relation that states `nullable` must agree with its local fields: nullable
 * exactly when one of them is nullable (a field that is not declared counts as nullable). A
 * relation without the flag is left to hydration, which derives it the same way.
 */
function toOneRelationNullabilityError(
  qualifiedName: string,
  relationName: string,
  relation: ContractRelation,
  model: ContractModel<MongoModelStorage>,
): string | undefined {
  const isSameSpaceToOne =
    'on' in relation &&
    (relation.cardinality === '1:1' || relation.cardinality === 'N:1') &&
    relation.to.space === undefined;
  if (!isSameSpaceToOne || relation.nullable === undefined) return undefined;
  const location = `Relation "${relationName}" on model "${qualifiedName}"`;
  const { ownsForeignKey, fields } = resolveMongoToOneRelationFields(model, relation);
  if (!ownsForeignKey) {
    return relation.nullable
      ? undefined
      : `${location} is required but does not own the foreign key, so nothing in storage guarantees the related document exists`;
  }
  const anyNullable = fields.some((field) => field.nullable);
  if (relation.nullable === anyNullable) return undefined;
  const fieldList = fields
    .filter((field) => field.nullable !== relation.nullable)
    .map((field) => `"${field.name}"`)
    .join(', ');
  return relation.nullable
    ? `${location} is nullable but every local field is required (fields ${fieldList})`
    : `${location} is required but a local field is nullable (fields ${fieldList})`;
}
