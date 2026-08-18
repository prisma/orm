import type { ContractField, ContractValueObject } from '@internal/contract/types';
import type { MongoModelDefinition } from '@internal/mongo-contract';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { freezeMongoFieldShape, freezeMongoResultShape } from '@internal/mongo-query-ast/execution';

export type MongoValueObjects = Readonly<Record<string, ContractValueObject>>;

const UNKNOWN: MongoFieldShape = Object.freeze({ kind: 'unknown' as const });

function valueObjectFields(
  valueObject: ContractValueObject,
  valueObjects: MongoValueObjects,
  enclosing: ReadonlySet<string>,
): Record<string, MongoFieldShape> {
  return Object.fromEntries(
    Object.entries(valueObject.fields).map(([name, field]) => [
      name,
      fieldShape(field, valueObjects, enclosing),
    ]),
  );
}

function elementShape(
  field: ContractField,
  valueObjects: MongoValueObjects,
  enclosing: ReadonlySet<string>,
): MongoFieldShape {
  const { type } = field;
  const nullable = !!field.many && field.many.elementNullable;
  if (type.kind === 'scalar') {
    return { kind: 'leaf', codecId: type.codecId, nullable };
  }
  if (type.kind !== 'valueObject' || enclosing.has(type.name)) return UNKNOWN;
  const valueObject = valueObjects[type.name];
  if (valueObject === undefined) return UNKNOWN;
  return {
    kind: 'document',
    nullable,
    fields: valueObjectFields(valueObject, valueObjects, new Set([...enclosing, type.name])),
  };
}

function fieldShape(
  field: ContractField,
  valueObjects: MongoValueObjects,
  enclosing: ReadonlySet<string>,
): MongoFieldShape {
  if (field.dict === true) return UNKNOWN;
  const element = elementShape(field, valueObjects, enclosing);
  if (element.kind === 'unknown') return UNKNOWN;
  if (field.many) {
    return { kind: 'array', nullable: field.nullable, element };
  }
  return { ...element, nullable: field.nullable };
}

/**
 * The shape the runtime decodes one field against. A value-object field becomes a document of its own fields when `valueObjects` holds its definition; a value object nested inside itself is left undecoded.
 */
export function contractFieldToMongoFieldShape(
  field: ContractField,
  valueObjects: MongoValueObjects = {},
): MongoFieldShape {
  return freezeMongoFieldShape(fieldShape(field, valueObjects, new Set()));
}

export function contractModelToMongoResultShape(
  model: MongoModelDefinition,
  options?: {
    readonly selection?: readonly string[];
    /** The shape of each included relation, keyed by relation name. */
    readonly includes?: Readonly<Record<string, MongoFieldShape>>;
    readonly valueObjects?: MongoValueObjects;
  },
): MongoResultShape {
  const fields: Record<string, MongoFieldShape> = { ...options?.includes };
  const modelFields = model.fields;
  // An explicit empty selection is honored as-is (returns a document shape
  // with no fields). Only the absence of a selection falls back to the model's
  // full field set.
  const keys = options?.selection !== undefined ? options.selection : Object.keys(modelFields);

  for (const key of keys) {
    if (Object.hasOwn(fields, key)) {
      continue;
    }
    const cf = modelFields[key];
    if (!cf) {
      fields[key] = UNKNOWN;
      continue;
    }
    fields[key] = contractFieldToMongoFieldShape(cf, options?.valueObjects);
  }
  return freezeMongoResultShape({ kind: 'document', fields });
}
