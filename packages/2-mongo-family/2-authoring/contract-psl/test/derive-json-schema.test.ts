import type { ContractField, ContractValueObject } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  deriveJsonSchema,
  derivePolymorphicJsonSchema,
  type FieldValueSets,
} from '../src/derive-json-schema';

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
  'mongo/bool@1': ['bool'],
  'mongo/date@1': ['date'],
  'mongo/objectId@1': ['objectId'],
  'mongo/double@1': ['double'],
  'mongo/int64@1': ['long'],
  'mongo/decimal128@1': ['decimal'],
  'mongo/binary@1': ['binData'],
  'mongo/json@1': [],
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  renderOutputTypeFor: () => undefined,
};

function scalarField(codecId: string, nullable = false): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable };
}

function enumField(codecId: string, enumName: string, nullable = false): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

function arrayField(codecId: string, nullable = false): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable, many: true };
}

function arrayEnumField(codecId: string, enumName: string, nullable = false): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    many: true,
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

function voField(name: string, nullable = false): ContractField {
  return { type: { kind: 'valueObject', name }, nullable };
}

function voArrayField(name: string, nullable = false): ContractField {
  return { type: { kind: 'valueObject', name }, nullable, many: true };
}

describe('deriveJsonSchema', () => {
  it('maps Int64, Decimal128 and Binary to long, decimal and binData', () => {
    const result = deriveJsonSchema(
      {
        views: scalarField('mongo/int64@1'),
        price: scalarField('mongo/decimal128@1'),
        thumbnail: scalarField('mongo/binary@1'),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema['properties']).toEqual({
      views: { bsonType: 'long' },
      price: { bsonType: 'decimal' },
      thumbnail: { bsonType: 'binData' },
    });
  });

  it('admits any value in a field whose codec has no BSON type, such as Json', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        meta: scalarField('mongo/json@1'),
        notes: scalarField('mongo/json@1', true),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'meta'],
      properties: {
        _id: { bsonType: 'objectId' },
        meta: {},
        notes: {},
      },
      additionalProperties: false,
    });
  });

  it('maps String, Int32, Bool, Date, ObjectId to correct BSON types', () => {
    const result = deriveJsonSchema(
      {
        name: scalarField('mongo/string@1'),
        age: scalarField('mongo/int32@1'),
        active: scalarField('mongo/bool@1'),
        created: scalarField('mongo/date@1'),
        _id: scalarField('mongo/objectId@1'),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'active', 'age', 'created', 'name'],
      properties: {
        name: { bsonType: 'string' },
        age: { bsonType: 'int' },
        active: { bsonType: 'bool' },
        created: { bsonType: 'date' },
        _id: { bsonType: 'objectId' },
      },
      additionalProperties: false,
    });
    expect(result.validationLevel).toBe('strict');
    expect(result.validationAction).toBe('error');
  });

  it('handles nullable field with bsonType array including null', () => {
    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), email: scalarField('mongo/string@1', true) },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id'],
      properties: {
        _id: { bsonType: 'objectId' },
        email: { bsonType: ['null', 'string'] },
      },
      additionalProperties: false,
    });
  });

  it('handles array field (many: true)', () => {
    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), tags: arrayField('mongo/string@1') },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'tags'],
      properties: {
        _id: { bsonType: 'objectId' },
        tags: { bsonType: 'array', items: { bsonType: 'string' } },
      },
      additionalProperties: false,
    });
  });

  it('handles nullable array field', () => {
    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), tags: arrayField('mongo/string@1', true) },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id'],
      properties: {
        _id: { bsonType: 'objectId' },
        tags: { bsonType: 'array', items: { bsonType: 'string' } },
      },
      additionalProperties: false,
    });
  });

  it('handles value object field as a closed nested object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: scalarField('mongo/string@1'),
          city: scalarField('mongo/string@1'),
          zip: scalarField('mongo/string@1', true),
        },
      },
    };

    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      valueObjects,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'address'],
      properties: {
        _id: { bsonType: 'objectId' },
        address: {
          bsonType: 'object',
          required: ['city', 'street'],
          properties: {
            street: { bsonType: 'string' },
            city: { bsonType: 'string' },
            zip: { bsonType: ['null', 'string'] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });
  });

  it('handles value object array field', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Tag: {
        fields: {
          label: scalarField('mongo/string@1'),
        },
      },
    };

    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), tags: voArrayField('Tag') },
      valueObjects,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'tags'],
      properties: {
        _id: { bsonType: 'objectId' },
        tags: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['label'],
            properties: {
              label: { bsonType: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
  });

  it('derives a minimal closed schema from an empty field set', () => {
    const result = deriveJsonSchema({}, undefined, mongoCodecLookup);

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('handles mixed nullable and non-nullable fields', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        name: scalarField('mongo/string@1'),
        bio: scalarField('mongo/string@1', true),
        age: scalarField('mongo/int32@1'),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'age', 'name'],
      properties: {
        _id: { bsonType: 'objectId' },
        name: { bsonType: 'string' },
        bio: { bsonType: ['null', 'string'] },
        age: { bsonType: 'int' },
      },
      additionalProperties: false,
    });
  });

  it('skips fields with unknown codec IDs', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        name: scalarField('mongo/string@1'),
        custom: scalarField('custom/unknown@1'),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'name'],
      properties: {
        _id: { bsonType: 'objectId' },
        name: { bsonType: 'string' },
      },
      additionalProperties: false,
    });
  });

  it('handles nested value objects (recursive), closing every level', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Geo: {
        fields: {
          lat: scalarField('mongo/int32@1'),
          lng: scalarField('mongo/int32@1'),
        },
      },
      Address: {
        fields: {
          city: scalarField('mongo/string@1'),
          geo: voField('Geo'),
        },
      },
    };

    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      valueObjects,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'address'],
      properties: {
        _id: { bsonType: 'objectId' },
        address: {
          bsonType: 'object',
          required: ['city', 'geo'],
          properties: {
            city: { bsonType: 'string' },
            geo: {
              bsonType: 'object',
              required: ['lat', 'lng'],
              properties: {
                lat: { bsonType: 'int' },
                lng: { bsonType: 'int' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });
  });

  it('maps Double (mongo/double@1) to bsonType "double"', () => {
    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), price: scalarField('mongo/double@1') },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'price'],
      properties: {
        _id: { bsonType: 'objectId' },
        price: { bsonType: 'double' },
      },
      additionalProperties: false,
    });
  });

  it('does not add _id to nested value-object schemas', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: { city: scalarField('mongo/string@1') },
      },
    };

    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      valueObjects,
      mongoCodecLookup,
    );

    const properties = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    const nested = properties['address'] as Record<string, unknown>;
    const nestedProps = nested['properties'] as Record<string, unknown>;
    expect(nestedProps).not.toHaveProperty('_id');
    expect(nested['additionalProperties']).toBe(false);
  });

  it('emits the _id property from the declared field', () => {
    const result = deriveJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      undefined,
      mongoCodecLookup,
    );

    const properties = result.jsonSchema['properties'] as Record<string, unknown>;
    expect(properties['_id']).toEqual({ bsonType: 'objectId' });
  });
});

describe('derivePolymorphicJsonSchema', () => {
  it('includes discriminatorField in required for each oneOf branch', () => {
    const result = derivePolymorphicJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [
        { discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } },
        { discriminatorValue: 'Cat', fields: { indoor: scalarField('mongo/bool@1') } },
      ],
      undefined,
      mongoCodecLookup,
    );

    const oneOf = result.jsonSchema['oneOf'] as Record<string, unknown>[];
    expect(oneOf).toHaveLength(2);
    for (const branch of oneOf) {
      expect(branch['required']).toContain('_type');
    }
  });

  it('emits oneOf branch even for single variant with no extra fields', () => {
    const result = derivePolymorphicJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [{ discriminatorValue: 'OnlyVariant', fields: {} }],
      undefined,
      mongoCodecLookup,
    );

    const oneOf = result.jsonSchema['oneOf'] as Record<string, unknown>[];
    expect(oneOf).toHaveLength(1);
    expect(oneOf[0]).toMatchObject({
      properties: { _type: { enum: ['OnlyVariant'] } },
      required: ['_type'],
    });
  });

  it('closes each oneOf branch with additionalProperties:false and lists base + variant fields', () => {
    const result = derivePolymorphicJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [
        { discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } },
        { discriminatorValue: 'Cat', fields: { indoor: scalarField('mongo/bool@1') } },
      ],
      undefined,
      mongoCodecLookup,
    );

    const oneOf = result.jsonSchema['oneOf'] as Record<string, Record<string, unknown>>[];
    const dog = oneOf[0]!;
    expect(dog['additionalProperties']).toBe(false);
    const dogProps = dog['properties'] as Record<string, unknown>;
    // Base properties are repeated into the branch so additionalProperties:false
    // does not reject them when the branch is evaluated independently.
    expect(dogProps).toHaveProperty('_id');
    expect(dogProps).toHaveProperty('name');
    expect(dogProps).toHaveProperty('breed');
    expect(dogProps['_type']).toEqual({ enum: ['Dog'] });
    expect(dogProps).not.toHaveProperty('indoor');

    const cat = oneOf[1]!;
    expect(cat['additionalProperties']).toBe(false);
    const catProps = cat['properties'] as Record<string, unknown>;
    expect(catProps).toHaveProperty('indoor');
    expect(catProps).not.toHaveProperty('breed');
  });

  it('leaves the polymorphic top-level schema open so closed branches drive validation', () => {
    const result = derivePolymorphicJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [{ discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } }],
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).not.toHaveProperty('additionalProperties');
    expect(result.jsonSchema).toHaveProperty('properties._id');
  });

  it('repeats the base _id into every branch', () => {
    const result = derivePolymorphicJsonSchema(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      'kind',
      [{ discriminatorValue: 'a', fields: { extra: scalarField('mongo/string@1') } }],
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toHaveProperty('properties._id');
    const oneOf = result.jsonSchema['oneOf'] as Record<string, Record<string, unknown>>[];
    const branchProps = oneOf[0]!['properties'] as Record<string, unknown>;
    expect(branchProps['_id']).toEqual({ bsonType: 'objectId' });
  });
});

describe('deriveJsonSchema — enum fields', () => {
  const valueSets: FieldValueSets = { Role: { values: ['user', 'admin'] } };

  it('emits enum: [...values] in declaration order for an enum-valueSet field', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        role: enumField('mongo/string@1', 'Role'),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['role']).toEqual({ bsonType: 'string', enum: ['user', 'admin'] });
    expect(result.validationLevel).toBe('strict');
  });

  it('omits enum keyword for non-enum scalar fields', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        name: scalarField('mongo/string@1'),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['name']).toEqual({ bsonType: 'string' });
    expect(props['name']).not.toHaveProperty('enum');
  });

  it('nullable enum field includes null in the enum array so null writes are accepted', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        role: enumField('mongo/string@1', 'Role', true),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['role']).toEqual({ bsonType: ['null', 'string'], enum: ['user', 'admin', null] });
  });

  it('array enum field emits enum inside items, not on the outer schema', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        roles: arrayEnumField('mongo/string@1', 'Role'),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['roles']).toEqual({
      bsonType: 'array',
      items: { bsonType: 'string', enum: ['user', 'admin'] },
    });
    expect(props['roles']).not.toHaveProperty('enum');
  });

  it('nullable array enum field emits enum inside items with no null in items', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        roles: arrayEnumField('mongo/string@1', 'Role', true),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['roles']).toEqual({
      bsonType: 'array',
      items: { bsonType: 'string', enum: ['user', 'admin'] },
    });
    expect(props['roles']).not.toHaveProperty('enum');
    // Intentional asymmetry: nullable+many keeps bsonType:'array' (not ['null','array']).
    // MongoDB treats a document missing the field as absent (allowed when not in required[]);
    // a document with the field present as null is rejected because null is not an array.
    // The cross-family convention is: nullable-array = "field may be absent", not "field may be null".
    expect(props['roles']?.['bsonType']).toBe('array');
    expect(props['roles']?.['bsonType']).not.toEqual(['null', 'array']);
  });

  it('preserves member value declaration order', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        status: enumField('mongo/string@1', 'Status'),
      },
      undefined,
      mongoCodecLookup,
      { Status: { values: ['c', 'a', 'b'] } },
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['status']?.['enum']).toEqual(['c', 'a', 'b']);
  });

  it('skips enum injection when the value set does not contain the referenced entry', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        role: enumField('mongo/string@1', 'UnknownEnum'),
      },
      undefined,
      mongoCodecLookup,
      valueSets,
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['role']).toEqual({ bsonType: 'string' });
    expect(props['role']).not.toHaveProperty('enum');
  });

  it('sources the enum keyword from the value set only (a differing domain enum is never consulted)', () => {
    // The deriver takes a value-set map and nothing else — it cannot read `domain.enum`. Passing a
    // value set whose values differ from any domain enum proves the `enum` keyword follows the value
    // set, not the domain enum.
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        role: enumField('mongo/string@1', 'Role'),
      },
      undefined,
      mongoCodecLookup,
      { Role: { values: ['from-value-set-a', 'from-value-set-b'] } },
    );

    const props = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['role']).toEqual({
      bsonType: 'string',
      enum: ['from-value-set-a', 'from-value-set-b'],
    });
  });
});
