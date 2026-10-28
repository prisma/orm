import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { EnumBlockSite } from '@internal/framework-components/authoring';
import {
  describeDiscriminatorRefusal,
  enumMemberProblemDiagnostic,
} from '@internal/framework-components/authoring';
import type { MongoContractRefusal } from '@internal/mongo-contract';
import type {
  BuildRefusal,
  FieldKey,
  IndexNode,
  RestatedFieldDifference,
} from '@internal/mongo-contract-ts/contract-builder';
import type { DiagnosticSource, FieldSymbol, PslDiagnostic, PslSpan } from '@internal/psl-parser';
import { InternalError } from '@internal/utils/internal-error';
import type { ResolvedTypeAlias } from './type-aliases';

/** Where a part of the schema is written, for a diagnostic about it. */
export interface Site {
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
}

/** A field as the schema writes it: its symbol, what typed it, and the generator attributes it carries. */
export interface FieldSite {
  readonly symbol: FieldSymbol;
  readonly source: DiagnosticSource;
  readonly typeAlias?: ResolvedTypeAlias;
  readonly generatorAttributes: Partial<
    Record<'onCreate' | 'onUpdate', { readonly span: PslSpan; readonly argument: string }>
  >;
  /** The `@map` on a member of a composite type. */
  readonly map?: Site;
  readonly storedName: string;
}

/** Where a model's polymorphism and indexes are written. */
export interface ModelSites {
  /** Each of the model's indexes, in the order the definition lists them. */
  readonly indexes: readonly (Site & { readonly index: IndexNode })[];
  readonly discriminator?: Site & { readonly fieldName: string };
  readonly base?: Site & { readonly valueSpan: PslSpan };
}

/** Where an enum block is written. */
export interface EnumSite {
  readonly block: EnumBlockSite;
  readonly codecSpan: PslSpan;
}

export interface SchemaSites {
  readonly models: ReadonlyMap<string, ModelSites>;
  readonly fields: ReadonlyMap<string, FieldSite>;
  readonly enums: ReadonlyMap<string, EnumSite>;
}

export function fieldSiteKey(owner: string, fieldName: string): string {
  return JSON.stringify([owner, fieldName]);
}

function fieldSiteOf(sites: SchemaSites, key: FieldKey): FieldSite {
  const site = sites.fields.get(fieldSiteKey(key.owner.name, key.field));
  if (site === undefined) {
    throw new InternalError(`A refused field "${key.owner.name}.${key.field}" has a site.`);
  }
  return site;
}

function modelSitesOf(sites: SchemaSites, model: string): ModelSites {
  const modelSites = sites.models.get(model);
  if (modelSites === undefined) throw new InternalError(`A refused model "${model}" has sites.`);
  return modelSites;
}

function at(site: Site, code: string, message: string): PslDiagnostic {
  return { code, message, ...site.source.at(site.span) };
}

function atField(field: FieldSite, code: string, message: string): PslDiagnostic {
  return { code, message, ...field.source.at(field.symbol.span) };
}

function atFieldCall(field: FieldSite, code: string, message: string): PslDiagnostic {
  return {
    code,
    message,
    ...field.source.at(field.symbol.typeConstructor?.span ?? field.symbol.span),
  };
}

function generatedListDiagnostic(field: FieldSite, label: string): PslDiagnostic {
  const perElement = 'Lists have no per-element generated values;';
  const phase = field.generatorAttributes.onCreate !== undefined ? 'onCreate' : 'onUpdate';
  const attribute = field.generatorAttributes[phase];
  if (attribute !== undefined) {
    return {
      code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
      message: `${label} is a list and cannot use @${phase}(${attribute.argument}). ${perElement} remove @${phase}(...).`,
      ...field.source.at(attribute.span),
    };
  }
  return atField(
    field,
    'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
    `${label} is a list, and its type alias "${field.typeAlias?.name}" generates a value. ${perElement} remove "[]" or type the field without the alias.`,
  );
}

function generatedOnValueObjectDiagnostic(field: FieldSite, owner: string): PslDiagnostic {
  const fieldName = field.symbol.name;
  return atField(
    field,
    'PSL_UNSUPPORTED_FIELD_TYPE',
    `Member "${fieldName}" of composite type "${owner}" is typed by the type alias "${field.typeAlias?.name}", which generates a value; a composite type member has no generated values.`,
  );
}

function relationNullabilityDiagnostic(
  field: FieldSite,
  model: string,
  ownsForeignKey: boolean,
): PslDiagnostic {
  const fieldLabel = `Relation field "${model}.${field.symbol.name}"`;
  if (!ownsForeignKey) {
    return atField(
      field,
      'PSL_REQUIRED_ONE_TO_ONE_BACKRELATION',
      `${fieldLabel} is required, but the other model holds the relation fields, so nothing in storage guarantees the related document exists. Make it optional with "?".`,
    );
  }
  return atField(
    field,
    'PSL_RELATION_NULLABILITY_MISMATCH',
    field.symbol.optional
      ? `${fieldLabel} is optional but every field in @relation(fields: [...]) is required. Make one of those fields optional with "?" or remove "?" from "${field.symbol.name}".`
      : `${fieldLabel} is required but a field in @relation(fields: [...]) is optional. Add "?" to "${field.symbol.name}" or make those fields required.`,
  );
}

const INDEX_SHAPE_MESSAGES = {
  'unique-wildcard': () => 'Unique indexes cannot use wildcard() fields',
  'hashed-several-fields': () => 'Hashed indexes must have exactly one field',
  'ttl-with-wildcard': () => 'expireAfterSeconds cannot be combined with wildcard() fields',
  'projection-without-wildcard': () =>
    'include/exclude options are only valid when the index contains a wildcard() field',
  'collation-without-locale': () => 'collationLocale is required when using collation options',
  'second-text-index': (model: string) =>
    `Only one @@textIndex is allowed per collection (model "${model}")`,
} as const;

function validatorDiagnostic(
  refusal: MongoContractRefusal,
  sites: SchemaSites,
): PslDiagnostic | ContractSourceDiagnostic {
  switch (refusal.kind) {
    case 'enumBsonType':
    case 'enumNotListable':
    case 'enumMemberNotListable': {
      const site = sites.enums.get(refusal.enumName);
      if (site === undefined) throw new InternalError(`Enum "${refusal.enumName}" has a site.`);
      const subject = `enum "${refusal.enumName}"`;
      const base = { code: 'PSL_EXTENSION_INVALID_VALUE', sourceId: site.block.sourceId };
      if (refusal.kind === 'enumBsonType') {
        return { ...base, message: `${subject} ${refusal.refusal.reason}`, span: site.codecSpan };
      }
      if (refusal.kind === 'enumNotListable') {
        return {
          ...base,
          message: `${subject} @@type codec "${refusal.codecId}" ${refusal.reason}`,
          span: site.codecSpan,
        };
      }
      return {
        ...base,
        message: `${subject} member "${refusal.member}" ${refusal.reason}`,
        span: site.block.memberSpans[refusal.member] ?? site.codecSpan,
      };
    }
    case 'fieldBsonType':
    case 'documentId': {
      const owner = refusal.kind === 'fieldBsonType' ? refusal.owner.name : refusal.modelName;
      const field = fieldSiteOf(sites, {
        kind: 'field',
        owner: { kind: 'model', name: owner },
        field: refusal.fieldName,
      });
      return atField(
        field,
        refusal.kind === 'fieldBsonType' ? 'PSL_UNSUPPORTED_FIELD_TYPE' : 'PSL_MONGO_ID_INVALID',
        `Field "${owner}.${field.symbol.name}" ${refusal.kind === 'fieldBsonType' ? refusal.refusal.reason : refusal.reason}`,
      );
    }
    case 'embeddedModelHasVariants':
      throw new InternalError('A PSL schema writes no embed relations.');
  }
}

/**
 * The diagnostic for one refusal of the builder, at the place in the schema it is about, worded as PSL words it. A source position comes from the refusal's key.
 */
export function refusalDiagnostic(
  refusal: BuildRefusal,
  sites: SchemaSites,
): PslDiagnostic | ContractSourceDiagnostic {
  switch (refusal.kind) {
    case 'storedNameUnsupported': {
      const field = fieldSiteOf(sites, refusal.key);
      return atField(
        field,
        'PSL_STORED_NAME_UNSUPPORTED',
        `Field "${refusal.key.owner.name}.${refusal.key.field}" ${refusal.reason}. Give the field another stored name with @map.`,
      );
    }
    case 'storedNameDuplicate': {
      const model = refusal.key.owner.name;
      return atField(
        fieldSiteOf(sites, refusal.key),
        'PSL_DUPLICATE_STORED_NAME',
        `Fields "${model}.${refusal.firstField}" and "${model}.${refusal.key.field}" are both stored as "${refusal.storedName}". Give each field its own stored name with @map.`,
      );
    }
    case 'restatedBaseFieldDiffers':
      return atField(
        fieldSiteOf(sites, refusal.key),
        'PSL_VARIANT_FIELD_DIFFERS_FROM_BASE',
        `Field "${refusal.key.owner.name}.${refusal.key.field}" restates field "${refusal.key.field}" of base model "${refusal.baseModel}" with a different ${refusal.differences.map(differenceWording).join(' and ')}. A variant's documents are checked against the base's field, so declare it exactly as the base does, or remove it from the variant.`,
      );
    case 'storedNameSharedWithBase':
      return atField(
        fieldSiteOf(sites, refusal.key),
        'PSL_DUPLICATE_STORED_NAME',
        `Fields "${refusal.baseModel}.${refusal.baseField}" and "${refusal.key.owner.name}.${refusal.key.field}" are both stored as "${refusal.storedName}", and a variant's documents hold its base's fields too. Give each field its own stored name with @map.`,
      );
    case 'valueObjectFieldStoredName': {
      const field = fieldSiteOf(sites, refusal.key);
      const site = field.map ?? { source: field.source, span: field.symbol.span };
      return at(
        site,
        'PSL_MONGO_TYPE_FIELD_MAP_UNSUPPORTED',
        `Field "${refusal.key.owner.name}.${refusal.key.field}" has @map, but a field of a composite type is stored under its own name. Remove @map, or rename the field to the name it is stored under.`,
      );
    }
    case 'relationLocalFieldUnknown': {
      const { model, relation } = refusal.key;
      return atField(
        fieldSiteOf(sites, {
          kind: 'field',
          owner: { kind: 'model', name: model },
          field: relation,
        }),
        'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        `Relation field "${model}.${relation}" joins on field "${refusal.fieldName}", which model "${model}" does not declare`,
      );
    }
    case 'relationNullability': {
      const { model, relation } = refusal.key;
      return relationNullabilityDiagnostic(
        fieldSiteOf(sites, {
          kind: 'field',
          owner: { kind: 'model', name: model },
          field: relation,
        }),
        model,
        refusal.ownsForeignKey,
      );
    }
    case 'variantCollectionDiffers': {
      const base = modelSitesOf(sites, refusal.key.model).base;
      if (base === undefined) throw new InternalError('A variant has a @@base site.');
      return at(
        base,
        'PSL_MONGO_VARIANT_SEPARATE_COLLECTION',
        `Mongo variant "${refusal.key.model}" cannot use a different collection than its base "${refusal.baseModel}". Mongo only supports single-collection polymorphism.`,
      );
    }
    case 'indexFieldUnknown':
    case 'indexShape':
    case 'indexScopeConflict':
    case 'indexDuplicate': {
      const { model, position } = refusal.key;
      const site = modelSitesOf(sites, model).indexes[position];
      if (site === undefined)
        throw new InternalError(`Index ${position} of "${model}" has a site.`);
      switch (refusal.kind) {
        case 'indexFieldUnknown':
          return at(
            site,
            'PSL_INDEX_FIELD_NOT_FOUND',
            `Index on model "${model}" references unknown field "${refusal.fieldName}"`,
          );
        case 'indexShape':
          return at(
            site,
            'PSL_INVALID_INDEX',
            refusal.rule === 'wildcard-with-type'
              ? `wildcard() fields cannot be combined with type: ${wildcardTypeOf(site.index)}`
              : INDEX_SHAPE_MESSAGES[refusal.rule](model),
          );
        case 'indexScopeConflict':
          return at(
            site,
            'PSL_INVALID_INDEX',
            `Variant "${model}" index conflicts with discriminator scope: ${refusal.reason}`,
          );
        case 'indexDuplicate':
          return at(
            site,
            'PSL_INVALID_INDEX',
            refusal.firstModel === model
              ? `Model "${model}" declares this index twice. Remove one of them.`
              : `Collection "${refusal.collection}" already has this index, declared on model "${refusal.firstModel}". Remove one of them from model "${model}" or "${refusal.firstModel}".`,
          );
      }
      break;
    }
    case 'generatedOnValueObject':
      return generatedOnValueObjectDiagnostic(
        fieldSiteOf(sites, refusal.key),
        refusal.key.owner.name,
      );
    case 'generatorPhaseSetTwice':
      throw new InternalError(
        `Field "${refusal.key.owner.name}.${refusal.key.field}" sets a phase twice, which PSL refuses as a repeated type alias attribute before building.`,
      );
    case 'generatedList':
      return generatedListDiagnostic(
        fieldSiteOf(sites, refusal.key),
        `Field "${refusal.key.owner.name}.${refusal.key.field}"`,
      );
    case 'generatedOnVariant': {
      const field = fieldSiteOf(sites, refusal.key);
      return atField(
        field,
        'PSL_GENERATOR_ON_VARIANT_FIELD',
        `Generated value on variant "${refusal.key.owner.name}" field "${refusal.key.field}": execution defaults apply to every document in collection "${refusal.collection}", so declare them on the base model.`,
      );
    }
    case 'generatedConflict': {
      const field = fieldSiteOf(sites, refusal.key);
      return atField(
        field,
        'PSL_GENERATOR_CONFLICT',
        `Generated value on "${refusal.key.owner.name}.${refusal.key.field}" sets different execution defaults than "${refusal.otherModel}.${refusal.otherField}" for field "${field.storedName}" of collection "${refusal.collection}". Generate the same values on both models.`,
      );
    }
    case 'typeParamsInvalid': {
      const field = fieldSiteOf(sites, refusal.key);
      const label = `Field "${refusal.key.owner.name}.${refusal.key.field}"`;
      return atFieldCall(
        field,
        'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        `${label} has type parameters its type refuses: ${refusal.problem.message}`,
      );
    }
    case 'enumMemberProblem': {
      const site = sites.enums.get(refusal.enumName);
      if (site === undefined) throw new InternalError(`Enum "${refusal.enumName}" has a site.`);
      return enumMemberProblemDiagnostic(refusal.problem, site.block);
    }
    case 'enumUnknown': {
      const field = fieldSiteOf(sites, refusal.key);
      return atField(
        field,
        'PSL_UNRESOLVED_REFERENCE',
        `Field "${refusal.key.owner.name}.${refusal.key.field}" is typed by enum "${refusal.enumName}", which the schema does not declare`,
      );
    }
    case 'discriminatorValueDuplicate': {
      const base = modelSitesOf(sites, refusal.key.variant).base;
      if (base === undefined) throw new InternalError('A variant has a @@base site.');
      return at(
        base,
        'PSL_DUPLICATE_DISCRIMINATOR_VALUE',
        `Discriminator value "${refusal.value}" is used by both "${refusal.firstVariant}" and "${refusal.key.variant}" on base model "${refusal.baseModel}"`,
      );
    }
    case 'discriminatorFieldUnknown':
    case 'discriminatorField':
    case 'discriminatorAndBase':
    case 'discriminatorWithoutVariants': {
      const model = refusal.key.model;
      const site = modelSitesOf(sites, model).discriminator;
      if (site === undefined) throw new InternalError('A base has a @@discriminator site.');
      switch (refusal.kind) {
        case 'discriminatorFieldUnknown':
          return at(
            site,
            'PSL_DISCRIMINATOR_FIELD_NOT_FOUND',
            `Discriminator field "${refusal.fieldName}" is not a field on model "${model}"`,
          );
        case 'discriminatorField':
          return at(
            site,
            'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            describeDiscriminatorRefusal(refusal.refusal, {
              modelName: model,
              fieldName: refusal.fieldName,
              typeName: discriminatorTypeName(sites, model, refusal.fieldName),
              enumName: undefined,
              variantName: () => model,
            }),
          );
        case 'discriminatorAndBase':
          return at(
            site,
            'PSL_DISCRIMINATOR_AND_BASE',
            `Model "${model}" cannot have both @@discriminator and @@base`,
          );
        case 'discriminatorWithoutVariants':
          return at(
            site,
            'PSL_ORPHANED_DISCRIMINATOR',
            `Model "${model}" has @@discriminator but no variant models declare @@base(${model}, ...)`,
          );
      }
      break;
    }
    case 'discriminatorValue': {
      const base = modelSitesOf(sites, refusal.key.variant).base;
      if (base === undefined) throw new InternalError('A variant has a @@base site.');
      const valueSite = { source: base.source, span: base.valueSpan };
      if (refusal.refusal.kind === 'unreadable') {
        return { ...refusal.refusal.refusal, ...valueSite.source.at(valueSite.span) };
      }
      return at(
        valueSite,
        'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        describeDiscriminatorRefusal(refusal.refusal, {
          modelName: refusal.baseModel,
          fieldName: refusal.fieldName,
          typeName: discriminatorTypeName(sites, refusal.baseModel, refusal.fieldName),
          enumName: refusal.enumName,
          variantName: (variant) => variant,
        }),
      );
    }
    case 'baseWithoutDiscriminator': {
      const base = modelSitesOf(sites, refusal.key.variant).base;
      if (base === undefined) throw new InternalError('A variant has a @@base site.');
      return at(
        base,
        'PSL_ORPHANED_BASE',
        `Model "${refusal.key.variant}" declares @@base(${refusal.baseModel}, ...) but "${refusal.baseModel}" has no @@discriminator`,
      );
    }
    case 'validator':
      return validatorDiagnostic(refusal.refusal, sites);
    case 'duplicateModel':
    case 'duplicateValueObject':
    case 'collectionSettingWithoutCollection':
    case 'collectionSettingTwice':
    case 'generatorUnknown':
    case 'generatorNotApplicable':
    case 'generatedWithoutCollection':
    case 'enumKeyMismatch':
    case 'listedVariantMissing':
    case 'baseUnknown':
    case 'variantWithoutValue':
      throw new InternalError(`A PSL definition cannot be refused with "${refusal.kind}".`);
  }
}

/** The key type a wildcard index combines with. */
function wildcardTypeOf(index: IndexNode): string {
  return (
    Object.values(index.fields).find(
      (direction) => direction === 'hashed' || direction === '2d' || direction === '2dsphere',
    ) ?? 'hashed'
  ).toString();
}

function discriminatorTypeName(sites: SchemaSites, model: string, fieldName: string): string {
  return sites.fields.get(fieldSiteKey(model, fieldName))?.symbol.typeName ?? fieldName;
}

function differenceWording(difference: RestatedFieldDifference): string {
  switch (difference) {
    case 'storedName':
      return '@map';
    case 'type':
      return 'type';
    case 'nullable':
      return 'optionality';
    case 'many':
      return 'list shape';
  }
}
