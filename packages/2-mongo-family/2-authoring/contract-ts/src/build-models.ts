import {
  type ContractEmbedRelation,
  type ContractField,
  type ContractModel,
  type ContractReferenceRelation,
  type ContractValueObject,
  type ContractValueObjectField,
  type CrossReference,
  crossRef,
} from '@internal/contract/types';
import { resolveToOneRelationNullable } from '@internal/contract-authoring';
import { type MongoModelStorage, unsupportedStoredNameReason } from '@internal/mongo-contract';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { ifDefined } from '@internal/utils/defined';
import {
  type BuildRefusal,
  modelFieldKey,
  type RelationKey,
  type RestatedFieldDifference,
  valueObjectFieldKey,
} from './build-refusals';
import type {
  ContractDefinition,
  FieldNode,
  ModelNode,
  ReferenceRelationNode,
  RelationNode,
  ValueObjectNode,
} from './contract-definition';

export function storedNameOf(field: FieldNode): string {
  return field.storedName ?? field.fieldName;
}

/** The name documents store `fieldName` under, or `fieldName` itself when the fields do not declare it. */
export function storedFieldNameIn(fields: readonly FieldNode[], fieldName: string): string {
  const field = fields.find((candidate) => candidate.fieldName === fieldName);
  return field === undefined ? fieldName : storedNameOf(field);
}

function fieldWithoutValueSet(field: FieldNode): Omit<ContractField, 'valueSet'> {
  return { type: field.type, nullable: field.nullable, many: field.many };
}

/** A model's fields. A field an enum types refers to the domain enum. */
function buildFields(
  fields: readonly FieldNode[],
  namespaceId: string,
): Record<string, ContractField> {
  return Object.fromEntries(
    fields.map((field) => [
      field.fieldName,
      {
        ...fieldWithoutValueSet(field),
        ...ifDefined(
          'valueSet',
          field.enumName === undefined
            ? undefined
            : ({
                plane: 'domain',
                entityKind: 'enum',
                namespaceId,
                entityName: field.enumName,
              } as const),
        ),
      },
    ]),
  );
}

/** A value object's members. A value object is a storage entity, and storage never refers to the domain plane, so a member an enum types refers to the enum's storage value set. */
function buildValueObjectMembers(
  fields: readonly FieldNode[],
  namespaceId: string,
): Record<string, ContractValueObjectField> {
  return Object.fromEntries(
    fields.map((field) => [
      field.fieldName,
      {
        ...fieldWithoutValueSet(field),
        ...ifDefined(
          'valueSet',
          field.enumName === undefined
            ? undefined
            : ({
                plane: 'storage',
                entityKind: 'valueSet',
                namespaceId,
                entityName: field.enumName,
              } as const),
        ),
      },
    ]),
  );
}

function buildStorageFields(
  modelName: string,
  fields: readonly FieldNode[],
  refusals: BuildRefusal[],
): Record<string, { readonly field: string }> {
  const storageFields: Record<string, { readonly field: string }> = {};
  const fieldsByStoredName = new Map<string, string>();
  for (const field of fields) {
    const { fieldName } = field;
    const key = modelFieldKey(modelName, fieldName);
    const storedName = storedNameOf(field);
    const unsupported = unsupportedStoredNameReason(storedName);
    if (unsupported !== undefined) {
      refusals.push({ kind: 'storedNameUnsupported', key, reason: unsupported });
    }
    const firstField = fieldsByStoredName.get(storedName);
    if (firstField !== undefined) {
      refusals.push({ kind: 'storedNameDuplicate', key, storedName, firstField });
      continue;
    }
    fieldsByStoredName.set(storedName, fieldName);
    storageFields[fieldName] = { field: storedName };
  }
  return storageFields;
}

function toOneRelationNullable(
  key: RelationKey,
  relation: ReferenceRelationNode,
  fields: readonly FieldNode[],
  refusals: BuildRefusal[],
): boolean {
  const ownsForeignKey = relation.cardinality !== '1:1';
  const localFields: FieldNode[] = [];
  if (ownsForeignKey) {
    for (const fieldName of relation.on.localFields) {
      const localField = fields.find((field) => field.fieldName === fieldName);
      if (localField === undefined) {
        refusals.push({ kind: 'relationLocalFieldUnknown', key, fieldName });
        return relation.nullable ?? false;
      }
      localFields.push(localField);
    }
  }
  const { nullable, contradiction } = resolveToOneRelationNullable({
    declaredNullable: relation.nullable,
    localFieldNullability: localFields.map((localField) => localField.nullable === true),
    ownsReference: ownsForeignKey,
  });
  if (contradiction !== undefined) {
    refusals.push({ kind: 'relationNullability', key, ownsForeignKey, contradiction });
  }
  return nullable;
}

function buildRelation(
  model: ModelNode,
  relation: RelationNode,
  namespaceId: string,
  refusals: BuildRefusal[],
): ContractEmbedRelation | ContractReferenceRelation {
  const to = crossRef(relation.toModel, namespaceId);
  if (relation.on === undefined) {
    return { to, cardinality: relation.cardinality };
  }
  if (relation.cardinality === '1:N') {
    return { to, cardinality: '1:N', on: relation.on };
  }
  const key = {
    kind: 'relation',
    model: model.modelName,
    relation: relation.relationName,
  } as const;
  return {
    to,
    cardinality: relation.cardinality,
    nullable: toOneRelationNullable(key, relation, model.fields, refusals),
    on: relation.on,
  };
}

export function buildValueObjects(
  valueObjects: readonly ValueObjectNode[] | undefined,
  namespaceId: string,
  refusals: BuildRefusal[],
): Record<string, ContractValueObject> {
  const builtValueObjects: Record<string, ContractValueObject> = {};

  for (const valueObject of valueObjects ?? []) {
    if (valueObject.name in builtValueObjects) {
      refusals.push({
        kind: 'duplicateValueObject',
        key: { kind: 'valueObject', valueObject: valueObject.name },
      });
      continue;
    }
    for (const field of valueObject.fields) {
      if (field.storedName !== undefined) {
        refusals.push({
          kind: 'valueObjectFieldStoredName',
          key: valueObjectFieldKey(valueObject.name, field.fieldName),
        });
      }
    }
    builtValueObjects[valueObject.name] = {
      fields: buildValueObjectMembers(valueObject.fields, namespaceId),
    };
  }

  return builtValueObjects;
}

/**
 * Refuses a variant field stored under a name another field of its base is stored under. A variant's documents hold its base's fields too, so the two would overwrite each other, the discriminator included. A variant that restates a base field under the same name restates that field.
 */
function restatementDifferences(
  variantField: FieldNode,
  baseField: FieldNode,
): RestatedFieldDifference[] {
  const differences: RestatedFieldDifference[] = [];
  if (storedNameOf(variantField) !== storedNameOf(baseField)) differences.push('storedName');
  if (
    canonicalStringify([variantField.type, variantField.enumName]) !==
    canonicalStringify([baseField.type, baseField.enumName])
  ) {
    differences.push('type');
  }
  if (variantField.nullable !== baseField.nullable) differences.push('nullable');
  if (canonicalStringify(variantField.many) !== canonicalStringify(baseField.many)) {
    differences.push('many');
  }
  return differences;
}

/**
 * A variant's documents hold its base's fields too, and its collection's validator is written from the base. A variant field may restate a base field only exactly, and may not take a stored name a different base field uses.
 */
function checkFieldsAgainstBase(
  variant: ModelNode,
  models: readonly ModelNode[],
  refusals: BuildRefusal[],
): void {
  if (variant.base === undefined) return;
  const baseName = variant.base.model;
  const base = models.find((model) => model.modelName === baseName);
  if (base === undefined) return;
  const baseFieldsByName = new Map(base.fields.map((field) => [field.fieldName, field]));
  const baseFieldsByStoredName = new Map(base.fields.map((field) => [storedNameOf(field), field]));
  for (const field of variant.fields) {
    const key = modelFieldKey(variant.modelName, field.fieldName);
    const restated = baseFieldsByName.get(field.fieldName);
    if (restated !== undefined) {
      const differences = restatementDifferences(field, restated);
      if (differences.length > 0) {
        refusals.push({ kind: 'restatedBaseFieldDiffers', key, baseModel: baseName, differences });
      }
      continue;
    }
    const storedName = storedNameOf(field);
    const baseField = baseFieldsByStoredName.get(storedName);
    if (baseField === undefined) continue;
    refusals.push({
      kind: 'storedNameSharedWithBase',
      key,
      storedName,
      baseModel: baseName,
      baseField: baseField.fieldName,
    });
  }
}

/**
 * Each model of the contract. `variantValues` holds each accepted variant's discriminator value as its base's field stores it; a base lists those variants.
 */
export function buildModels(input: {
  readonly models: readonly ModelNode[];
  readonly variantValues: ReadonlyMap<string, string>;
  readonly namespaceId: string;
  readonly refusals: BuildRefusal[];
}): Record<string, ContractModel<MongoModelStorage>> {
  const { models, variantValues, namespaceId, refusals } = input;
  const builtModels: Record<string, ContractModel<MongoModelStorage>> = {};

  for (const model of models) {
    const { modelName } = model;
    if (modelName in builtModels) {
      refusals.push({ kind: 'duplicateModel', key: { kind: 'model', model: modelName } });
      continue;
    }

    checkFieldsAgainstBase(model, models, refusals);
    const storage = {
      ...(model.collection ? { collection: model.collection } : {}),
      fields: buildStorageFields(modelName, model.fields, refusals),
      ...(model.storageRelations ? { relations: model.storageRelations } : {}),
    };

    const variants =
      model.discriminator === undefined
        ? undefined
        : models.flatMap((variant) => {
            const value = variantValues.get(variant.modelName);
            return variant.base?.model === modelName && value !== undefined
              ? [[value, crossRef(variant.modelName, namespaceId)] as const]
              : [];
          });

    builtModels[modelName] = {
      fields: buildFields(model.fields, namespaceId),
      relations: Object.fromEntries(
        (model.relations ?? []).map((relation) => [
          relation.relationName,
          buildRelation(model, relation, namespaceId, refusals),
        ]),
      ),
      storage,
      ...(model.owner ? { owner: model.owner } : {}),
      ...(model.base ? { base: crossRef(model.base.model, namespaceId) } : {}),
      ...(model.discriminator ? { discriminator: { field: model.discriminator.field } } : {}),
      ...(variants === undefined ? {} : { variants: Object.fromEntries(variants) }),
    };
  }

  return builtModels;
}

export function buildRoots(
  definition: ContractDefinition,
  models: readonly ModelNode[],
  namespaceId: string,
): Record<string, CrossReference> {
  if (definition.roots !== undefined) {
    return Object.fromEntries(
      Object.entries(definition.roots).map(([rootName, modelName]) => [
        rootName,
        crossRef(modelName, namespaceId),
      ]),
    );
  }
  const roots: Record<string, CrossReference> = {};
  for (const model of models) {
    if (!model.collection || model.owner || model.base) continue;
    roots[model.collection] = crossRef(model.modelName, namespaceId);
  }
  return roots;
}
