import {
  type ContractField,
  type ContractModel,
  type ContractValueObject,
  type StorageBase,
  valueObjectAt,
} from '@internal/contract/types';
import { type MongoModelStorage, ownStoredNamesOf } from '@internal/mongo-contract';
import type { MongoFieldShape, MongoResultShape } from '@internal/mongo-query-ast/execution';
import { freezeMongoFieldShape, freezeMongoResultShape } from '@internal/mongo-query-ast/execution';

const UNKNOWN: MongoFieldShape = Object.freeze({ kind: 'unknown' as const });

const NO_STORAGE: Pick<StorageBase, 'namespaces'> = { namespaces: {} };

function valueObjectFields(
  valueObject: ContractValueObject,
  storage: Pick<StorageBase, 'namespaces'>,
  enclosing: ReadonlySet<ContractValueObject>,
): Record<string, MongoFieldShape> {
  return Object.fromEntries(
    Object.entries(valueObject.fields).map(([name, field]) => [
      name,
      fieldShape(field, storage, enclosing),
    ]),
  );
}

function elementShape(
  field: ContractField,
  storage: Pick<StorageBase, 'namespaces'>,
  enclosing: ReadonlySet<ContractValueObject>,
): MongoFieldShape {
  const { type } = field;
  const nullable = !!field.many && field.many.elementNullable;
  if (type.kind === 'scalar') {
    return { kind: 'leaf', codecId: type.codecId, nullable };
  }
  if (type.kind !== 'valueObject') return UNKNOWN;
  const valueObject = valueObjectAt(storage, type);
  if (valueObject === undefined || enclosing.has(valueObject)) return UNKNOWN;
  return {
    kind: 'document',
    nullable,
    fields: valueObjectFields(valueObject, storage, new Set([...enclosing, valueObject])),
  };
}

function fieldShape(
  field: ContractField,
  storage: Pick<StorageBase, 'namespaces'>,
  enclosing: ReadonlySet<ContractValueObject>,
): MongoFieldShape {
  if (field.dict === true) return UNKNOWN;
  const element = elementShape(field, storage, enclosing);
  if (element.kind === 'unknown') return UNKNOWN;
  if (field.many) {
    return { kind: 'array', nullable: field.nullable, element };
  }
  return { ...element, nullable: field.nullable };
}

/**
 * The shape the runtime decodes one field against. A value-object field becomes a document of its own fields when `storage` holds the value object its reference names; a value object nested inside itself is left undecoded.
 */
export function contractFieldToMongoFieldShape(
  field: ContractField,
  storage: Pick<StorageBase, 'namespaces'> = NO_STORAGE,
): MongoFieldShape {
  return freezeMongoFieldShape(fieldShape(field, storage, new Set()));
}

/**
 * The shape the runtime decodes a model's documents against, keyed by stored name. `selection` names stored names; `includes` is keyed by relation name.
 */
export function contractModelToMongoResultShape(
  model: ContractModel<MongoModelStorage>,
  options?: {
    readonly selection?: readonly string[];
    /** The shape of each included relation, keyed by relation name. */
    readonly includes?: Readonly<Record<string, MongoFieldShape>>;
    readonly storage?: Pick<StorageBase, 'namespaces'>;
  },
): MongoResultShape {
  const fields: Record<string, MongoFieldShape> = { ...options?.includes };
  const fieldsByStoredName = new Map(
    Object.entries(ownStoredNamesOf(model)).map(([field, storedName]) => [storedName, field]),
  );
  // An explicit empty selection is honored as-is (returns a document shape
  // with no fields). Only the absence of a selection falls back to the model's
  // full field set.
  const keys =
    options?.selection !== undefined ? options.selection : [...fieldsByStoredName.keys()];

  for (const key of keys) {
    if (Object.hasOwn(fields, key)) {
      continue;
    }
    const fieldName = fieldsByStoredName.get(key);
    const cf = fieldName === undefined ? undefined : model.fields[fieldName];
    if (!cf) {
      fields[key] = UNKNOWN;
      continue;
    }
    fields[key] = contractFieldToMongoFieldShape(cf, options?.storage);
  }
  return freezeMongoResultShape({ kind: 'document', fields });
}
