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
 * `undefined` for a codec the lookup does not know. `null` for one it knows that declares no BSON type (`mongo/json@1` holds any value), which the validator admits unconstrained rather than dropping: with `additionalProperties: false` a dropped field would reject every document that carries it.
 */
function resolveBsonType(
  codecId: string,
  codecLookup: CodecLookup | undefined,
): string | null | undefined {
  const targetTypes = codecLookup?.targetTypesFor(codecId);
  if (targetTypes === undefined) return undefined;
  return targetTypes[0] ?? null;
}

function fieldToBsonSchema(
  field: ContractField,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
  valueSets: FieldValueSets | undefined,
): Record<string, unknown> | undefined {
  if (field.type.kind === 'scalar') {
    const bsonType = resolveBsonType(field.type.codecId, codecLookup);
    if (bsonType === undefined) return undefined;
    if (bsonType === null) {
      return 'many' in field && field.many ? { bsonType: 'array', items: {} } : {};
    }

    const enumValues =
      field.valueSet !== undefined
        ? (valueSets?.[field.valueSet.entityName]?.values ?? null)
        : null;

    if ('many' in field && field.many) {
      const items: Record<string, unknown> = { bsonType };
      if (enumValues) items['enum'] = enumValues;
      return { bsonType: 'array', items };
    }

    if (field.nullable) {
      const s: Record<string, unknown> = { bsonType: ['null', bsonType] };
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
    if ('many' in field && field.many) {
      return { bsonType: 'array', items: voSchema };
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
