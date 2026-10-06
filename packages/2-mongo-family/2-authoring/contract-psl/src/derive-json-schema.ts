import type { ContractField, ContractValueObject, JsonValue } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { MongoValidator } from '@internal/mongo-contract';

/**
 * The permitted values a field's value set restricts it to, keyed by the value set's name — the
 * storage `entries.valueSet` slot. The validator's `enum` keyword is sourced from these, not from
 * `domain.enum`.
 */
export type FieldValueSets = Record<string, { readonly values: readonly JsonValue[] }>;

/**
 * The `bsonType` keyword for a list of BSON type names: the name itself for one entry, the list for several.
 */
function bsonTypeKeyword(bsonTypes: readonly string[]): string | readonly string[] {
  const [only, ...rest] = bsonTypes;
  return only !== undefined && rest.length === 0 ? only : [...bsonTypes];
}

function withNull(bsonTypes: readonly string[]): readonly string[] {
  return bsonTypes.includes('null') ? bsonTypes : ['null', ...bsonTypes];
}

function anyValueSchema(field: ContractField): Record<string, unknown> {
  if ('many' in field && field.many) {
    return { bsonType: field.nullable ? ['null', 'array'] : 'array', items: {} };
  }
  return {};
}

function fieldToBsonSchema(
  field: ContractField,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
  valueSets: FieldValueSets | undefined,
): Record<string, unknown> | undefined {
  if (field.type.kind === 'scalar') {
    const bsonTypes = codecLookup?.targetTypesFor(field.type.codecId);
    if (bsonTypes === undefined) return undefined;
    if (bsonTypes.length === 0) return anyValueSchema(field);
    const bsonType = bsonTypeKeyword(bsonTypes);

    const enumValues =
      field.valueSet !== undefined
        ? (valueSets?.[field.valueSet.entityName]?.values ?? null)
        : null;

    if (field.many) {
      const items: Record<string, unknown> = {
        bsonType: field.many.elementNullable ? ['null', bsonType] : bsonType,
      };
      if (enumValues) {
        items['enum'] = field.many.elementNullable ? [...enumValues, null] : enumValues;
      }
      return { bsonType: field.nullable ? ['null', 'array'] : 'array', items };
    }

    if (field.nullable) {
      const s: Record<string, unknown> = { bsonType: bsonTypeKeyword(withNull(bsonTypes)) };
      if (enumValues) s['enum'] = [...enumValues, null];
      return s;
    }

    const s: Record<string, unknown> = { bsonType };
    if (enumValues) s['enum'] = enumValues;
    return s;
  }

  if (field.type.kind === 'valueObject') {
    const vo = valueObjects?.[field.type.name];
    if (!vo) return undefined;
    const voSchema = deriveObjectSchema(vo.fields, valueObjects, codecLookup, valueSets);
    if (field.many) {
      return {
        bsonType: field.nullable ? ['null', 'array'] : 'array',
        items: field.many.elementNullable ? { oneOf: [{ bsonType: 'null' }, voSchema] } : voSchema,
      };
    }
    if (field.nullable) {
      return { oneOf: [{ bsonType: 'null' }, voSchema] };
    }
    return voSchema;
  }

  return undefined;
}

function deriveObjectSchema(
  fields: Record<string, ContractField>,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
  valueSets: FieldValueSets | undefined,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of Object.entries(fields)) {
    const schema = fieldToBsonSchema(field, valueObjects, codecLookup, valueSets);
    if (schema) {
      properties[fieldName] = schema;
      if (!field.nullable) {
        required.push(fieldName);
      }
    }
  }

  const result: Record<string, unknown> = {
    bsonType: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    result['required'] = required.sort();
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deriveJsonSchema(
  fields: Record<string, ContractField>,
  valueObjects?: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
  valueSets?: FieldValueSets,
): MongoValidator {
  return new MongoValidator({
    jsonSchema: deriveObjectSchema(fields, valueObjects, codecLookup, valueSets),
    validationLevel: 'strict',
    validationAction: 'error',
  });
}

export interface PolymorphicVariant {
  readonly discriminatorValue: string;
  readonly fields: Record<string, ContractField>;
}

export function derivePolymorphicJsonSchema(
  baseFields: Record<string, ContractField>,
  discriminatorField: string,
  variants: readonly PolymorphicVariant[],
  valueObjects?: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
  valueSets?: FieldValueSets,
): MongoValidator {
  const baseSchema = deriveObjectSchema(baseFields, valueObjects, codecLookup, valueSets);
  const baseProperties = isRecord(baseSchema['properties']) ? baseSchema['properties'] : {};

  const oneOf: Record<string, unknown>[] = [];
  for (const variant of variants) {
    const variantOnlyFields: Record<string, ContractField> = {};
    for (const [name, field] of Object.entries(variant.fields)) {
      if (!(name in baseFields)) {
        variantOnlyFields[name] = field;
      }
    }

    const variantProperties: Record<string, unknown> = {};
    const variantRequired: string[] = [discriminatorField];
    for (const [name, field] of Object.entries(variantOnlyFields)) {
      const schema = fieldToBsonSchema(field, valueObjects, codecLookup, valueSets);
      if (schema) {
        variantProperties[name] = schema;
        if (!field.nullable) {
          variantRequired.push(name);
        }
      }
    }

    const entry: Record<string, unknown> = {
      properties: {
        ...baseProperties,
        [discriminatorField]: { enum: [variant.discriminatorValue] },
        ...variantProperties,
      },
      required: variantRequired.sort(),
      additionalProperties: false,
    };

    oneOf.push(entry);
  }

  const jsonSchema = { ...baseSchema };
  delete jsonSchema['additionalProperties'];
  if (oneOf.length > 0) {
    jsonSchema['oneOf'] = oneOf;
  }

  return new MongoValidator({
    jsonSchema,
    validationLevel: 'strict',
    validationAction: 'error',
  });
}
