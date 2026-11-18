import type { ContractField, ContractValueObjectField } from '@internal/contract/types';

/** A field with no value set: valid both on a model and as a value object member. */
type FieldWithoutValueSet = Omit<ContractField, 'valueSet'>;

export function scalarField(codecId: string, nullable = false): FieldWithoutValueSet {
  return { type: { kind: 'scalar', codecId }, nullable, many: false };
}

export function enumField(codecId: string, enumName: string, nullable = false): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    many: false,
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

export function arrayField(
  codecId: string,
  nullable = false,
  elementNullable = false,
): FieldWithoutValueSet {
  return { type: { kind: 'scalar', codecId }, nullable, many: { elementNullable } };
}

export function arrayEnumField(
  codecId: string,
  enumName: string,
  nullable = false,
  elementNullable = false,
): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    many: { elementNullable },
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

/** A value object member typed by an enum: it refers to the enum's storage value set, as a storage entity's field does. */
export function memberEnumField(codecId: string, enumName: string): ContractValueObjectField {
  return {
    type: { kind: 'scalar', codecId },
    nullable: false,
    many: false,
    valueSet: {
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

function valueObjectType(entityName: string, namespaceId = '__unbound__'): ContractField['type'] {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId,
    entityKind: 'valueObject',
    entityName,
  };
}

export function voField(
  name: string,
  nullable = false,
  namespaceId = '__unbound__',
): FieldWithoutValueSet {
  return { type: valueObjectType(name, namespaceId), nullable, many: false };
}

export function voArrayField(
  name: string,
  nullable = false,
  elementNullable = false,
): FieldWithoutValueSet {
  return { type: valueObjectType(name), nullable, many: { elementNullable } };
}
