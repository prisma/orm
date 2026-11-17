import type {
  ContractEnum,
  ContractField,
  ContractModel,
  ContractModelBase,
  ContractValueObject,
} from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import { type CollectionControlPolicies, isManaged } from './collection-control-policies';
import { collectionRootModelsOf } from './collection-root-models';
import type { MongoModelStorage } from './contract-types';
import { documentIdBsonTypesOf, documentIdRefusalOf } from './document-id-refusal';
import { type FieldBsonTypeRefusal, fieldBsonTypeRefusalOf } from './field-bson-type-refusal';
import { bsonTypesOfCodec } from './mongo-data-type';
import { isEmbedRelation } from './relation-fields';
import { ownDocumentIdFieldOf } from './stored-names';
import { validatorEnumMemberRefusalOf, validatorEnumRefusalOf } from './validator-enum-refusal';

export type FieldOwner =
  | { readonly kind: 'model'; readonly name: string }
  | { readonly kind: 'valueObject'; readonly name: string };

/**
 * A part of a MongoDB contract its collection validators cannot describe. Each reason leaves out its subject, so each authoring surface leads with its own and raises the refusal in its own error form.
 */
export type MongoContractRefusal =
  | {
      readonly kind: 'embeddedModelHasVariants';
      readonly modelName: string;
      readonly relationName: string;
      readonly embeddedModel: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'enumBsonType';
      readonly enumName: string;
      readonly codecId: string;
      readonly refusal: FieldBsonTypeRefusal;
    }
  | {
      readonly kind: 'enumNotListable';
      readonly enumName: string;
      readonly codecId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'enumMemberNotListable';
      readonly enumName: string;
      readonly member: string;
      readonly codecId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'fieldBsonType';
      readonly owner: FieldOwner;
      readonly fieldName: string;
      readonly codecId: string;
      readonly refusal: FieldBsonTypeRefusal;
    }
  | {
      readonly kind: 'documentId';
      readonly modelName: string;
      /** The model's field stored as `_id`. */
      readonly fieldName: string;
      readonly collection: string;
      readonly codecId: string;
      /** The BSON types the field can hold that an `_id` cannot have. */
      readonly forbidden: readonly string[];
      readonly reason: string;
    };

export interface MongoContractRefusalsInput {
  readonly models: Record<string, ContractModel<MongoModelStorage>>;
  readonly valueObjects: Record<string, ContractValueObject>;
  readonly enums: Record<string, ContractEnum>;
  readonly lookups: TypeLookups;
  readonly controlPolicies: CollectionControlPolicies;
}

/** Why an embed relation cannot target `embeddedModel`, a model with variants; the subject is the relation. */
function embeddedVariantsReason(embeddedModel: string): string {
  return `embeds model "${embeddedModel}", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.`;
}

/**
 * The parts of a MongoDB contract its validators cannot describe that can be decided without codec lookups: an embed relation to a model with variants. `mongoContractRefusalsOf` includes them, and `validateMongoStorage` applies them to a contract read back from `contract.json`.
 */
export function lookupFreeRefusalsOf(
  models: Record<string, ContractModelBase>,
): MongoContractRefusal[] {
  return Object.entries(models).flatMap(([modelName, model]) =>
    Object.entries(model.relations).flatMap(([relationName, relation]): MongoContractRefusal[] =>
      isEmbedRelation(relation) && models[relation.to.model]?.variants !== undefined
        ? [
            {
              kind: 'embeddedModelHasVariants',
              modelName,
              relationName,
              embeddedModel: relation.to.model,
              reason: embeddedVariantsReason(relation.to.model),
            },
          ]
        : [],
    ),
  );
}

/**
 * The enums a collection validator lists: those stored by a model in a managed collection, by one of its variants or embedded models, or by a value object any of them holds. A model field refers to its domain enum and a value object member to the enum's storage value set; both carry the enum's name.
 */
function validatedEnumNames(input: MongoContractRefusalsInput): ReadonlySet<string> {
  const { models, valueObjects, controlPolicies } = input;
  const visitedModels = new Set(
    Object.entries(collectionRootModelsOf(models)).flatMap(([collection, names]) =>
      isManaged(collection, controlPolicies) ? names : [],
    ),
  );
  const visitedValueObjects = new Set<string>();
  const enums = new Set<string>();
  const visitFields = (fields: Record<string, ContractField>) => {
    for (const field of Object.values(fields)) {
      if (field.valueSet !== undefined) enums.add(field.valueSet.entityName);
      if (field.type.kind === 'valueObject' && !visitedValueObjects.has(field.type.entityName)) {
        visitedValueObjects.add(field.type.entityName);
        visitFields(valueObjects[field.type.entityName]?.fields ?? {});
      }
    }
  };
  const pending = [...visitedModels];
  const reach = (name: string) => {
    if (visitedModels.has(name)) return;
    visitedModels.add(name);
    pending.push(name);
  };
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const model = models[name];
    if (model === undefined) continue;
    visitFields(model.fields);
    for (const relation of Object.values(model.relations)) {
      if (isEmbedRelation(relation)) reach(relation.to.model);
    }
    for (const [variant, candidate] of Object.entries(models)) {
      if (candidate.base?.model === name) reach(variant);
    }
  }
  return enums;
}

function enumRefusals(input: MongoContractRefusalsInput): MongoContractRefusal[] {
  const { enums, lookups } = input;
  const validated = validatedEnumNames(input);
  return Object.entries(enums).flatMap(([enumName, { codecId, members }]) => {
    const refusal = fieldBsonTypeRefusalOf(codecId, lookups);
    if (refusal !== undefined) return [{ kind: 'enumBsonType', enumName, codecId, refusal }];
    if (!validated.has(enumName)) return [];
    const bsonTypes = bsonTypesOfCodec(codecId, lookups) ?? [];
    const reason = validatorEnumRefusalOf(bsonTypes);
    if (reason !== undefined) return [{ kind: 'enumNotListable', enumName, codecId, reason }];
    return members.flatMap((member): MongoContractRefusal[] => {
      const memberReason = validatorEnumMemberRefusalOf(bsonTypes, member.value);
      return memberReason === undefined
        ? []
        : [
            {
              kind: 'enumMemberNotListable',
              enumName,
              member: member.name,
              codecId,
              reason: memberReason,
            },
          ];
    });
  });
}

function fieldRefusals(
  owner: FieldOwner,
  fields: Record<string, ContractField>,
  lookups: TypeLookups,
): MongoContractRefusal[] {
  return Object.entries(fields).flatMap(([fieldName, field]): MongoContractRefusal[] => {
    if (field.type.kind !== 'scalar') return [];
    const refusal = fieldBsonTypeRefusalOf(field.type.codecId, lookups);
    return refusal === undefined
      ? []
      : [{ kind: 'fieldBsonType', owner, fieldName, codecId: field.type.codecId, refusal }];
  });
}

function documentIdRefusals(
  models: Record<string, ContractModel<MongoModelStorage>>,
  lookups: TypeLookups,
): MongoContractRefusal[] {
  return Object.entries(collectionRootModelsOf(models)).flatMap(([collection, modelNames]) =>
    modelNames.flatMap((modelName): MongoContractRefusal[] => {
      const model = models[modelName];
      const id = model === undefined ? undefined : ownDocumentIdFieldOf(model);
      if (id === undefined || id.field.type.kind !== 'scalar') return [];
      const bsonTypes = documentIdBsonTypesOf(id.field, lookups);
      const codecId = id.field.type.codecId;
      const refusal = bsonTypes === undefined ? undefined : documentIdRefusalOf(codecId, bsonTypes);
      return refusal === undefined
        ? []
        : [{ kind: 'documentId', modelName, fieldName: id.name, collection, codecId, ...refusal }];
    }),
  );
}

/**
 * Every part of a built MongoDB contract that its collection validators cannot describe: an embed relation to a model with variants, an enum a validator of a managed collection cannot list, a field whose codec has no MongoDB data type, and a root model's field stored as `_id` that can hold a BSON type an `_id` cannot have. Both authoring surfaces call it on what they built, so the rules are decided in one place.
 */
export function mongoContractRefusalsOf(
  input: MongoContractRefusalsInput,
): readonly MongoContractRefusal[] {
  const { models, valueObjects, lookups } = input;
  return [
    ...lookupFreeRefusalsOf(models),
    ...enumRefusals(input),
    ...Object.entries(models).flatMap(([name, model]) =>
      fieldRefusals({ kind: 'model', name }, model.fields, lookups),
    ),
    ...Object.entries(valueObjects).flatMap(([name, valueObject]) =>
      fieldRefusals({ kind: 'valueObject', name }, valueObject.fields, lookups),
    ),
    ...documentIdRefusals(models, lookups),
  ];
}
