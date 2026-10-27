import { enumMemberError } from '@internal/contract-authoring';
import type { AuthoringWarning } from '@internal/framework-components/authoring';
import type { MongoContractRefusal } from '@internal/mongo-contract';
import { type StructuredError, structuredError } from '@internal/utils/structured-error';
import type {
  BuildRefusal,
  BuildWarning,
  FieldKey,
  RestatedFieldDifference,
} from './build-refusals';
import { contractError } from './contract-errors';

const LIST_THE_CODEC_PACK =
  'List the pack that provides the codec in `extensions` in defineContract.';

function codecRefusalError(
  subject: string,
  meta: Record<string, string>,
  codecId: string,
  refusal: Extract<MongoContractRefusal, { kind: 'fieldBsonType' }>['refusal'],
): StructuredError {
  if (refusal.kind === 'unknownCodec') {
    return contractError('CONTRACT.CODEC_DESCRIPTOR_MISSING', `${subject} ${refusal.reason}`, {
      fix: LIST_THE_CODEC_PACK,
      meta: { ...meta, codecId },
    });
  }
  return contractError('CONTRACT.PACK_CONTRIBUTION_INVALID', `${subject} ${refusal.reason}`, {
    fix: 'Use a codec whose data type is a MongoDB data type, declared with mongoDataType.',
    meta: { ...meta, codecId, dataType: refusal.dataType, reason: 'data-type-not-mongo' },
  });
}

function validatorRefusalError(refusal: MongoContractRefusal): StructuredError {
  switch (refusal.kind) {
    case 'embeddedModelHasVariants':
      return contractError(
        'CONTRACT.RELATION_INVALID',
        `Relation "${refusal.modelName}.${refusal.relationName}" ${refusal.reason}`,
        {
          meta: {
            modelName: refusal.modelName,
            relationName: refusal.relationName,
            reason: 'embedded-model-has-variants',
          },
        },
      );
    case 'enumBsonType':
      return codecRefusalError(
        `enumType("${refusal.enumName}")`,
        { enumName: refusal.enumName },
        refusal.codecId,
        refusal.refusal,
      );
    case 'enumNotListable':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${refusal.enumName}") codec "${refusal.codecId}" ${refusal.reason}`,
        {
          meta: {
            enumName: refusal.enumName,
            codecId: refusal.codecId,
            reason: 'not-listable-by-validator',
          },
        },
      );
    case 'enumMemberNotListable':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${refusal.enumName}") member "${refusal.member}" ${refusal.reason}`,
        {
          meta: {
            enumName: refusal.enumName,
            member: refusal.member,
            codecId: refusal.codecId,
            reason: 'member-not-listable-by-validator',
          },
        },
      );
    case 'fieldBsonType': {
      const { owner } = refusal;
      const label = owner.kind === 'model' ? 'Model' : 'Value object';
      const ownerMeta =
        owner.kind === 'model' ? { modelName: owner.name } : { valueObjectName: owner.name };
      return codecRefusalError(
        `${label} "${owner.name}" field "${refusal.fieldName}"`,
        { ...ownerMeta, fieldName: refusal.fieldName },
        refusal.codecId,
        refusal.refusal,
      );
    }
    case 'documentId':
      return contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Model "${refusal.modelName}" field "${refusal.fieldName}" ${refusal.reason}`,
        {
          meta: {
            modelName: refusal.modelName,
            fieldName: refusal.fieldName,
            collection: refusal.collection,
            codecId: refusal.codecId,
            bsonTypes: refusal.forbidden,
            reason: 'document-id-bson-type',
          },
        },
      );
  }
}

function defaultError(key: FieldKey, reason: string, message: string): StructuredError {
  const subject = `${key.owner.name}.${key.field}`;
  return contractError('CONTRACT.DEFAULT_INVALID', `Field "${subject}" ${message}`, {
    meta: { modelName: key.owner.name, fieldName: key.field, reason },
  });
}

function ownerMetaOf(key: FieldKey): Record<string, string> {
  return key.owner.kind === 'model'
    ? { modelName: key.owner.name, fieldName: key.field }
    : { valueObjectName: key.owner.name, fieldName: key.field };
}

function ownerLabelOf(key: FieldKey): string {
  return `${key.owner.kind === 'model' ? 'Model' : 'Value object'} "${key.owner.name}" field "${key.field}"`;
}

const INDEX_SHAPE_MESSAGES = {
  'unique-wildcard': 'is unique and has a wildcard key; a unique index cannot use a wildcard.',
  'wildcard-with-type':
    'combines a wildcard key with a hashed, 2d or 2dsphere key, which MongoDB does not allow.',
  'hashed-several-fields': 'is hashed on several fields; a hashed index has exactly one field.',
  'ttl-with-wildcard': 'sets expireAfterSeconds on a wildcard index, which MongoDB does not allow.',
  'projection-without-wildcard':
    'sets wildcardProjection but has no wildcard key; a wildcard projection needs a wildcard index.',
  'collation-without-locale': 'sets a collation without a locale; a collation needs a locale.',
  'second-text-index':
    'is a second text index in its collection; MongoDB allows one text index per collection.',
} as const;

function discriminatorFieldError(
  refusal: Extract<BuildRefusal, { kind: 'discriminatorField' }>,
): StructuredError {
  const field = `Discriminator field "${refusal.key.model}.${refusal.fieldName}"`;
  const meta = { modelName: refusal.key.model, fieldName: refusal.fieldName };
  switch (refusal.refusal.kind) {
    case 'optional':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `${field} must be required, but it is optional. Remove .optional().`,
        { meta: { ...meta, reason: 'discriminator-optional' } },
      );
    case 'list':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `${field} must hold one value, but it is a list. Remove .many().`,
        { meta: { ...meta, reason: 'discriminator-list' } },
      );
    case 'not-text': {
      const { dataType } = refusal.refusal;
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `${field} must be text, such as field.string(), but its data type is ${dataType === undefined ? 'not a scalar' : `"${dataType}"`}.`,
        { meta: { ...meta, dataType, reason: 'discriminator-not-text' } },
      );
    }
  }
}

/** The error `defineContract` throws for a refusal of the builder. */
export function refusalError(refusal: BuildRefusal): StructuredError {
  switch (refusal.kind) {
    case 'duplicateModel':
      return contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Duplicate model name "${refusal.key.model}" in defineContract().`,
        { meta: { kind: 'model', name: refusal.key.model } },
      );
    case 'duplicateValueObject':
      return contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Duplicate value object name "${refusal.key.valueObject}" in defineContract().`,
        { meta: { kind: 'valueObject', name: refusal.key.valueObject } },
      );
    case 'storedNameUnsupported':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.owner.name}" field "${refusal.key.field}" ${refusal.reason}. Give it another stored name.`,
        {
          meta: {
            modelName: refusal.key.owner.name,
            fieldName: refusal.key.field,
            reason: 'stored-name-unsupported',
          },
        },
      );
    case 'storedNameDuplicate':
      return contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Model "${refusal.key.owner.name}" stores both "${refusal.firstField}" and "${refusal.key.field}" as "${refusal.storedName}".`,
        {
          meta: {
            kind: 'field',
            name: refusal.storedName,
            first: refusal.firstField,
            second: refusal.key.field,
          },
        },
      );
    case 'restatedBaseFieldDiffers':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Variant model "${refusal.key.owner.name}" restates field "${refusal.key.field}" of its base "${refusal.baseModel}" with a different ${refusal.differences.map(differenceWording).join(' and ')}. A variant's documents are checked against the base's field, so restate it exactly or remove it from the variant.`,
        {
          meta: {
            modelName: refusal.key.owner.name,
            fieldName: refusal.key.field,
            baseModel: refusal.baseModel,
            differences: refusal.differences,
            reason: 'restated-base-field-differs',
          },
        },
      );
    case 'storedNameSharedWithBase':
      return contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Variant model "${refusal.key.owner.name}" field "${refusal.key.field}" is stored as "${refusal.storedName}", which its base "${refusal.baseModel}" stores field "${refusal.baseField}" under. A variant's documents hold its base's fields too, so give the field another stored name.`,
        {
          meta: {
            kind: 'field',
            name: refusal.storedName,
            first: `${refusal.baseModel}.${refusal.baseField}`,
            second: `${refusal.key.owner.name}.${refusal.key.field}`,
            reason: 'stored-name-shared-with-base',
          },
        },
      );
    case 'valueObjectFieldStoredName':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Value object "${refusal.key.owner.name}" field "${refusal.key.field}" sets .mongo({ field }), but a field of a value object is stored under its own name.`,
        {
          meta: {
            valueObjectName: refusal.key.owner.name,
            fieldName: refusal.key.field,
            reason: 'value-object-field-stored-name',
          },
        },
      );
    case 'relationLocalFieldUnknown': {
      const { model, relation } = refusal.key;
      return contractError(
        'CONTRACT.RELATION_INVALID',
        `Relation "${model}.${relation}" joins on local field "${refusal.fieldName}", which model "${model}" does not declare`,
        {
          meta: {
            modelName: model,
            relationName: relation,
            fieldName: refusal.fieldName,
            reason: 'local-field-unknown',
          },
        },
      );
    }
    case 'relationNullability': {
      const { model, relation } = refusal.key;
      const location = `Relation "${model}.${relation}"`;
      return contractError(
        'CONTRACT.RELATION_INVALID',
        !refusal.ownsForeignKey
          ? `${location} is required but does not own the foreign key, so nothing in storage guarantees the related document exists`
          : refusal.contradiction === 'declared-optional'
            ? `${location} is optional but every local field it joins on is required`
            : `${location} is required but a local field it joins on is nullable`,
        {
          meta: { modelName: model, relationName: relation, reason: 'to-one-nullability-mismatch' },
        },
      );
    }
    case 'collectionSettingWithoutCollection': {
      const modelName = refusal.key.model;
      const what = refusal.setting === 'controlPolicy' ? 'it' : 'them';
      return contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Model "${modelName}" defines ${refusal.setting} but has no collection to attach ${what} to.`,
        { meta: { modelName, reason: `${refusal.setting}-without-collection` } },
      );
    }
    case 'collectionSettingTwice':
      return contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Collection "${refusal.collection}" has ${refusal.setting} declared by multiple models. Author ${refusal.setting} on a single model per collection.`,
        {
          meta: {
            modelName: refusal.key.model,
            collection: refusal.collection,
            reason: `${refusal.setting}-declared-by-multiple-models`,
          },
        },
      );
    case 'variantCollectionDiffers':
      return contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Variant model "${refusal.key.model}" is stored in collection "${refusal.collection}", but its base "${refusal.baseModel}" is stored in "${refusal.baseCollection}". A variant is stored in its base's collection; leave its collection out.`,
        {
          meta: {
            modelName: refusal.key.model,
            collection: refusal.collection,
            baseModel: refusal.baseModel,
            baseCollection: refusal.baseCollection,
            reason: 'variant-collection-differs',
          },
        },
      );
    case 'indexFieldUnknown':
      return contractError(
        'CONTRACT.FIELD_UNKNOWN',
        `Model "${refusal.key.model}" index ${refusal.signature} references unknown field "${refusal.fieldName}".`,
        {
          meta: {
            modelName: refusal.key.model,
            fieldName: refusal.fieldName,
            indexSignature: refusal.signature,
          },
        },
      );
    case 'indexShape':
      return contractError(
        'CONTRACT.INDEX_INVALID',
        `Model "${refusal.key.model}" index ${refusal.signature} ${INDEX_SHAPE_MESSAGES[refusal.rule]}`,
        {
          meta: {
            modelName: refusal.key.model,
            indexSignature: refusal.signature,
            reason: refusal.rule,
          },
        },
      );
    case 'indexScopeConflict':
      return contractError(
        'CONTRACT.INDEX_INVALID',
        `Variant model "${refusal.key.model}" index ${refusal.signature} conflicts with discriminator scope: ${refusal.reason}`,
        {
          meta: {
            variantName: refusal.key.model,
            indexLabel: refusal.signature,
            reason: refusal.reason,
          },
        },
      );
    case 'indexDuplicate':
      return contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Collection "${refusal.collection}" defines duplicate index ${refusal.signature}. First declared on model "${refusal.firstModel}" and duplicated on model "${refusal.key.model}".`,
        {
          meta: {
            kind: 'index',
            name: refusal.signature,
            collection: refusal.collection,
            first: refusal.firstModel,
            second: refusal.key.model,
          },
        },
      );
    case 'generatedOnValueObject':
      return defaultError(
        refusal.key,
        'executionDefaults-on-value-object',
        'has executionDefaults, but it belongs to a value object. Generated values are only supported on model fields.',
      );
    case 'generatorUnknown': {
      const { owner, field } = refusal.key;
      return contractError(
        'CONTRACT.DEFAULT_INVALID',
        `Field "${owner.name}.${field}": no pack in the contract declares the generator function "${refusal.functionName}".`,
        {
          meta: {
            modelName: owner.name,
            fieldName: field,
            codecId: refusal.codecId,
            function: refusal.functionName,
            reason: 'generator-unknown',
          },
        },
      );
    }
    case 'generatorNotApplicable': {
      const { owner, field } = refusal.key;
      const subject = `Field "${owner.name}.${field}"`;
      return contractError(
        'CONTRACT.DEFAULT_INVALID',
        refusal.message !== undefined
          ? `${subject}: ${refusal.message}`
          : `${subject}: ${refusal.functionName}() does not apply to ${refusal.codecId === undefined ? "the field's type" : `codec "${refusal.codecId}"`}.`,
        {
          meta: {
            modelName: owner.name,
            fieldName: field,
            codecId: refusal.codecId,
            function: refusal.functionName,
            reason: 'generator-not-applicable',
          },
        },
      );
    }
    case 'generatorPhaseSetTwice':
      return contractError(
        'CONTRACT.DEFAULT_INVALID',
        `.${refusal.phase}() is called on a field that already generates a value ${refusal.phase === 'onCreate' ? 'on create' : 'on update'}. Set each phase once, and do not combine .${refusal.phase}() with a type alias or alias constant that sets it.`,
        {
          meta: {
            modelName: refusal.key.owner.name,
            fieldName: refusal.key.field,
            reason: 'generator-phase-set-twice',
            phase: refusal.phase,
          },
        },
      );
    case 'generatedList':
      return defaultError(
        refusal.key,
        'many-with-executionDefaults',
        'generates a value on write, so it cannot be a list; remove .many().',
      );
    case 'generatedOnVariant':
      return defaultError(
        refusal.key,
        'executionDefaults-on-variant',
        `has executionDefaults, but "${refusal.key.owner.name}" is a variant of "${refusal.baseModel}". Execution defaults apply to every document in collection "${refusal.collection}", so declare them on the base model.`,
      );
    case 'generatedWithoutCollection':
      return defaultError(
        refusal.key,
        'executionDefaults-without-collection',
        'has executionDefaults, but its model has no collection. Generated values are only supported on fields of a model stored in a collection.',
      );
    case 'generatedConflict':
      return defaultError(
        refusal.key,
        'executionDefaults-conflict',
        `has different executionDefaults than "${refusal.otherModel}.${refusal.otherField}", which is stored in the same collection "${refusal.collection}". Use the same executionDefaults on both models.`,
      );
    case 'typeParamsInvalid':
      return structuredError('CONTRACT.TYPE_PARAMS_INVALID', refusal.problem.message, {
        meta: {
          dataType: refusal.problem.dataType,
          parameters: refusal.problem.parameters,
          ...ownerMetaOf(refusal.key),
        },
      });
    case 'enumKeyMismatch':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enum declaration key "${refusal.key.enumName}" must match enumType name "${refusal.enumName}". Aliases are not supported.`,
        {
          meta: {
            enumName: refusal.enumName,
            declaredKey: refusal.key.enumName,
            reason: 'declaration-key-mismatch',
          },
        },
      );
    case 'enumMemberProblem':
      return enumMemberError(
        { enumName: refusal.enumName, codecId: refusal.codecId },
        refusal.problem,
        'the field',
      );
    case 'enumUnknown':
      return contractError(
        'CONTRACT.ENUM_UNKNOWN',
        `${ownerLabelOf(refusal.key)} references enum "${refusal.enumName}" which is not declared in defineContract({ enums: { ... } }).`,
        { meta: { ...ownerMetaOf(refusal.key), enumName: refusal.enumName } },
      );
    case 'discriminatorValueDuplicate':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Discriminator value "${refusal.value}" is used by both "${refusal.firstVariant}" and "${refusal.key.variant}" on base model "${refusal.baseModel}".`,
        {
          meta: {
            modelName: refusal.baseModel,
            value: refusal.value,
            variants: [refusal.firstVariant, refusal.key.variant],
            reason: 'duplicate-discriminator-value',
          },
        },
      );
    case 'discriminatorFieldUnknown':
      return contractError(
        'CONTRACT.FIELD_UNKNOWN',
        `Model "${refusal.key.model}" names "${refusal.fieldName}" as its discriminator, but declares no field "${refusal.fieldName}".`,
        {
          meta: {
            modelName: refusal.key.model,
            fieldName: refusal.fieldName,
            reason: 'discriminator-field-unknown',
          },
        },
      );
    case 'discriminatorField':
      return discriminatorFieldError(refusal);
    case 'discriminatorValue': {
      const variant = refusal.key.variant;
      const meta = {
        modelName: variant,
        baseModel: refusal.baseModel,
        fieldName: refusal.fieldName,
      };
      if (refusal.refusal.kind === 'unreadable') {
        return contractError(
          'CONTRACT.ARGUMENT_INVALID',
          `Variant model "${variant}" has a discriminator value that discriminator field "${refusal.baseModel}.${refusal.fieldName}" cannot hold: ${refusal.refusal.refusal.message}`,
          { meta: { ...meta, reason: 'discriminator-value-unreadable' } },
        );
      }
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Variant model "${variant}" has discriminator value ${JSON.stringify(refusal.refusal.stored)}, which is not a member of enum "${refusal.enumName}", the type of discriminator field "${refusal.baseModel}.${refusal.fieldName}". Use one of: ${refusal.refusal.members.map((member) => JSON.stringify(member)).join(', ')}.`,
        { meta: { ...meta, reason: 'discriminator-value-not-a-member' } },
      );
    }
    case 'discriminatorAndBase':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.model}" has both a discriminator and a base. A model is either a base with variants or a variant of one base.`,
        { meta: { modelName: refusal.key.model, reason: 'discriminator-and-base' } },
      );
    case 'discriminatorWithoutVariants':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.model}" has a discriminator, but no model names it as its base.`,
        { meta: { modelName: refusal.key.model, reason: 'discriminator-without-variants' } },
      );
    case 'listedVariantMissing':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.model}" lists variant "${refusal.variant}", but no model "${refusal.variant}" names "${refusal.key.model}" as its base.`,
        {
          meta: {
            modelName: refusal.key.model,
            variant: refusal.variant,
            reason: 'listed-variant-missing',
          },
        },
      );
    case 'baseWithoutDiscriminator':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.variant}" names "${refusal.baseModel}" as its base, but "${refusal.baseModel}" has no discriminator.`,
        {
          meta: {
            modelName: refusal.key.variant,
            baseModel: refusal.baseModel,
            reason: 'base-without-discriminator',
          },
        },
      );
    case 'baseUnknown':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.variant}" names "${refusal.baseModel}" as its base, but the contract has no model "${refusal.baseModel}".`,
        {
          meta: {
            modelName: refusal.key.variant,
            baseModel: refusal.baseModel,
            reason: 'base-unknown',
          },
        },
      );
    case 'variantWithoutValue':
      return contractError(
        'CONTRACT.ARGUMENT_INVALID',
        `Model "${refusal.key.variant}" names "${refusal.baseModel}" as its base, but "${refusal.baseModel}" lists no discriminator value for it.`,
        {
          meta: {
            modelName: refusal.key.variant,
            baseModel: refusal.baseModel,
            reason: 'variant-without-value',
          },
        },
      );
    case 'validator':
      return validatorRefusalError(refusal.refusal);
  }
}

/** A builder warning as `defineContract` reports it. */
export function authoringWarningOf(warning: BuildWarning): AuthoringWarning {
  return warning.warning;
}

function differenceWording(difference: RestatedFieldDifference): string {
  switch (difference) {
    case 'storedName':
      return 'stored name';
    case 'type':
      return 'type';
    case 'nullable':
      return 'nullability';
    case 'many':
      return 'list shape';
  }
}
