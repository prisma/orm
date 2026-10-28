import type {
  AuthoringWarning,
  DiscriminatorFieldRefusal,
  DiscriminatorVariantRefusal,
  EnumMemberProblem,
} from '@internal/framework-components/authoring';
import type { DataTypeParamsProblem } from '@internal/framework-components/codec';
import type { GeneratorPhase } from '@internal/framework-components/components';
import type { FieldOwner, MongoContractRefusal } from '@internal/mongo-contract';

/** The part of a definition a refusal is about, by names and positions the definition carries. */
export type RefusalKey =
  | { readonly kind: 'model'; readonly model: string }
  | { readonly kind: 'valueObject'; readonly valueObject: string }
  | { readonly kind: 'field'; readonly owner: FieldOwner; readonly field: string }
  | { readonly kind: 'enum'; readonly enumName: string }
  | { readonly kind: 'enumMember'; readonly enumName: string; readonly member: string }
  /** `position` counts the model's own indexes, in the order the definition lists them. */
  | { readonly kind: 'index'; readonly model: string; readonly position: number }
  | { readonly kind: 'relation'; readonly model: string; readonly relation: string }
  /** The base model's discriminator. */
  | { readonly kind: 'discriminator'; readonly model: string }
  /** The variant's base and its discriminator value. */
  | { readonly kind: 'base'; readonly variant: string }
  /** The collection settings of the model that declares them. */
  | { readonly kind: 'collectionSettings'; readonly model: string };

export type ModelKey = Extract<RefusalKey, { readonly kind: 'model' }>;
export type ValueObjectKey = Extract<RefusalKey, { readonly kind: 'valueObject' }>;
export type FieldKey = Extract<RefusalKey, { readonly kind: 'field' }>;
export type EnumKey = Extract<RefusalKey, { readonly kind: 'enum' }>;
export type IndexKey = Extract<RefusalKey, { readonly kind: 'index' }>;
export type RelationKey = Extract<RefusalKey, { readonly kind: 'relation' }>;
export type DiscriminatorKey = Extract<RefusalKey, { readonly kind: 'discriminator' }>;
export type BaseKey = Extract<RefusalKey, { readonly kind: 'base' }>;
export type CollectionSettingsKey = Extract<RefusalKey, { readonly kind: 'collectionSettings' }>;

/** What a variant's restatement of a base field changes, which the collection's validator, written from the base, would refuse. */
export type RestatedFieldDifference = 'storedName' | 'type' | 'nullable' | 'many';

export type CollectionSetting = 'indexes' | 'collectionOptions' | 'controlPolicy';

export type IndexShapeRule =
  | 'unique-wildcard'
  | 'wildcard-with-type'
  | 'hashed-several-fields'
  | 'ttl-with-wildcard'
  | 'projection-without-wildcard'
  | 'collation-without-locale'
  | 'second-text-index';

/** Why the builder refuses part of a definition, keyed by the part. Each source words the refusal itself. */
export type BuildRefusal =
  | { readonly kind: 'duplicateModel'; readonly key: ModelKey }
  | { readonly kind: 'duplicateValueObject'; readonly key: ValueObjectKey }
  | { readonly kind: 'storedNameUnsupported'; readonly key: FieldKey; readonly reason: string }
  | {
      readonly kind: 'storedNameDuplicate';
      readonly key: FieldKey;
      readonly storedName: string;
      readonly firstField: string;
    }
  | {
      readonly kind: 'storedNameSharedWithBase';
      readonly key: FieldKey;
      readonly storedName: string;
      readonly baseModel: string;
      readonly baseField: string;
    }
  | {
      readonly kind: 'restatedBaseFieldDiffers';
      readonly key: FieldKey;
      readonly baseModel: string;
      readonly differences: readonly RestatedFieldDifference[];
    }
  | { readonly kind: 'valueObjectFieldStoredName'; readonly key: FieldKey }
  | {
      readonly kind: 'relationLocalFieldUnknown';
      readonly key: RelationKey;
      readonly fieldName: string;
    }
  | {
      readonly kind: 'relationNullability';
      readonly key: RelationKey;
      readonly ownsForeignKey: boolean;
      readonly contradiction: 'declared-optional' | 'declared-required';
    }
  | {
      readonly kind: 'collectionSettingWithoutCollection';
      readonly key: CollectionSettingsKey;
      readonly setting: CollectionSetting;
    }
  | {
      readonly kind: 'collectionSettingTwice';
      readonly key: CollectionSettingsKey;
      readonly setting: Exclude<CollectionSetting, 'indexes'>;
      readonly collection: string;
    }
  | {
      readonly kind: 'variantCollectionDiffers';
      readonly key: CollectionSettingsKey;
      readonly collection: string;
      readonly baseModel: string;
      readonly baseCollection: string;
    }
  | {
      readonly kind: 'indexFieldUnknown';
      readonly key: IndexKey;
      readonly fieldName: string;
      readonly signature: string;
    }
  | {
      readonly kind: 'indexShape';
      readonly key: IndexKey;
      readonly rule: IndexShapeRule;
      readonly signature: string;
    }
  | {
      readonly kind: 'indexScopeConflict';
      readonly key: IndexKey;
      readonly reason: string;
      readonly signature: string;
    }
  | {
      readonly kind: 'indexDuplicate';
      readonly key: IndexKey;
      readonly collection: string;
      readonly firstModel: string;
      readonly signature: string;
    }
  | { readonly kind: 'generatedOnValueObject'; readonly key: FieldKey }
  | {
      readonly kind: 'generatorUnknown';
      readonly key: FieldKey;
      readonly phase: GeneratorPhase;
      readonly functionName: string;
      readonly codecId: string | undefined;
    }
  | {
      readonly kind: 'generatorNotApplicable';
      readonly key: FieldKey;
      readonly phase: GeneratorPhase;
      readonly functionName: string;
      readonly codecId: string | undefined;
      /** The generator's own reason, when it refuses the field rather than not applying to its codec. */
      readonly message: string | undefined;
    }
  | {
      readonly kind: 'generatorPhaseSetTwice';
      readonly key: FieldKey;
      readonly phase: GeneratorPhase;
    }
  | { readonly kind: 'generatedList'; readonly key: FieldKey }
  | {
      readonly kind: 'generatedOnVariant';
      readonly key: FieldKey;
      readonly baseModel: string;
      readonly collection: string | undefined;
    }
  | { readonly kind: 'generatedWithoutCollection'; readonly key: FieldKey }
  | {
      readonly kind: 'generatedConflict';
      readonly key: FieldKey;
      readonly otherModel: string;
      readonly otherField: string;
      readonly collection: string;
    }
  | {
      readonly kind: 'typeParamsInvalid';
      readonly key: FieldKey;
      readonly problem: DataTypeParamsProblem;
    }
  | { readonly kind: 'enumKeyMismatch'; readonly key: EnumKey; readonly enumName: string }
  | {
      readonly kind: 'enumMemberProblem';
      readonly key: EnumKey | Extract<RefusalKey, { readonly kind: 'enumMember' }>;
      readonly enumName: string;
      readonly codecId: string;
      readonly problem: EnumMemberProblem;
    }
  | { readonly kind: 'enumUnknown'; readonly key: FieldKey; readonly enumName: string }
  | {
      readonly kind: 'discriminatorValueDuplicate';
      readonly key: BaseKey;
      readonly baseModel: string;
      readonly value: string;
      readonly firstVariant: string;
    }
  | {
      readonly kind: 'discriminatorFieldUnknown';
      readonly key: DiscriminatorKey;
      readonly fieldName: string;
    }
  | {
      readonly kind: 'discriminatorField';
      readonly key: DiscriminatorKey;
      readonly fieldName: string;
      readonly refusal: DiscriminatorFieldRefusal;
    }
  | {
      readonly kind: 'discriminatorValue';
      readonly key: BaseKey;
      readonly baseModel: string;
      readonly fieldName: string;
      readonly enumName: string | undefined;
      readonly refusal: DiscriminatorVariantRefusal<string>;
    }
  | { readonly kind: 'discriminatorAndBase'; readonly key: DiscriminatorKey }
  | { readonly kind: 'discriminatorWithoutVariants'; readonly key: DiscriminatorKey }
  | {
      readonly kind: 'listedVariantMissing';
      readonly key: DiscriminatorKey;
      readonly variant: string;
    }
  | { readonly kind: 'baseWithoutDiscriminator'; readonly key: BaseKey; readonly baseModel: string }
  | { readonly kind: 'baseUnknown'; readonly key: BaseKey; readonly baseModel: string }
  | { readonly kind: 'variantWithoutValue'; readonly key: BaseKey; readonly baseModel: string }
  | {
      readonly kind: 'validator';
      readonly key: RefusalKey;
      readonly refusal: MongoContractRefusal;
    };

/** Something the builder accepts but the author probably did not mean, or a warning the source collected. */
export type BuildWarning = { readonly kind: 'source'; readonly warning: AuthoringWarning };

export function modelFieldKey(model: string, field: string): FieldKey {
  return { kind: 'field', owner: { kind: 'model', name: model }, field };
}

export function valueObjectFieldKey(valueObject: string, field: string): FieldKey {
  return { kind: 'field', owner: { kind: 'valueObject', name: valueObject }, field };
}

/** The key of a validator refusal: the part of the definition its subject names. */
export function validatorRefusalKey(refusal: MongoContractRefusal): RefusalKey {
  switch (refusal.kind) {
    case 'embeddedModelHasVariants':
      return { kind: 'relation', model: refusal.modelName, relation: refusal.relationName };
    case 'enumBsonType':
    case 'enumNotListable':
      return { kind: 'enum', enumName: refusal.enumName };
    case 'enumMemberNotListable':
      return { kind: 'enumMember', enumName: refusal.enumName, member: refusal.member };
    case 'fieldBsonType':
      return { kind: 'field', owner: refusal.owner, field: refusal.fieldName };
    case 'documentId':
      return modelFieldKey(refusal.modelName, refusal.fieldName);
  }
}
