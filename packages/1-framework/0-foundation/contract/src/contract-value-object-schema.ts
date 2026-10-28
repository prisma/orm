import { type } from 'arktype';

const ScalarFieldTypeSchema = type({
  '+': 'reject',
  kind: "'scalar'",
  codecId: 'string',
  'typeParams?': 'Record<string, unknown>',
});

const ValueObjectReferenceSchema = type({
  '+': 'reject',
  kind: "'valueObject'",
  plane: "'storage'",
  namespaceId: 'string',
  entityKind: "'valueObject'",
  entityName: 'string',
});

const UnionFieldTypeSchema = type({
  '+': 'reject',
  kind: "'union'",
  members: ScalarFieldTypeSchema.or(ValueObjectReferenceSchema).array(),
});

/**
 * The type of a domain field or of a value object's member, `ContractFieldType`: a scalar with its codec, a value object by its storage coordinate, or a union of those. A union holds no union.
 */
export const ContractFieldTypeSchema = ScalarFieldTypeSchema.or(ValueObjectReferenceSchema).or(
  UnionFieldTypeSchema,
);

const StorageValueSetReferenceSchema = type({
  '+': 'reject',
  plane: "'storage'",
  namespaceId: 'string',
  entityKind: "'valueSet'",
  entityName: 'string',
  'spaceId?': 'string',
});

/** A value object's member, `ContractValueObjectField`. */
export const ContractValueObjectFieldSchema = type({
  '+': 'reject',
  nullable: 'boolean',
  type: ContractFieldTypeSchema,
  'many?': type('false').or({ '+': 'reject', elementNullable: 'boolean' }),
  'dict?': 'true',
  'valueSet?': StorageValueSetReferenceSchema,
});

/**
 * A value object, `ContractValueObject`: the storage entity under `storage.namespaces.<ns>.entries.valueObject.<name>` (ADR 309). The framework defines this entity kind, since domain fields refer to it; both families validate their entries against this schema.
 */
export const ContractValueObjectSchema = type({
  '+': 'reject',
  fields: type({ '[string]': ContractValueObjectFieldSchema }),
});
