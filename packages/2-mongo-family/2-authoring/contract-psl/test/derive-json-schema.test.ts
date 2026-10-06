import type { ContractValueObject } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { deriveJsonSchema, derivePolymorphicJsonSchema } from '../src/derive-json-schema';
import {
  arrayEnumField,
  arrayField,
  mongoCodecLookup,
  scalarField,
  voArrayField,
  voField,
} from './derive-json-schema-helpers';

describe('deriveJsonSchema', () => {
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

  it.each([
    ['strict required', arrayField('mongo/string@1'), ['tags'], 'array', { bsonType: 'string' }],
    [
      'nullable elements',
      arrayField('mongo/string@1', false, true),
      ['tags'],
      'array',
      { bsonType: ['null', 'string'] },
    ],
    [
      'nullable list',
      arrayField('mongo/string@1', true),
      undefined,
      ['null', 'array'],
      { bsonType: 'string' },
    ],
    [
      'nullable list and elements',
      arrayField('mongo/string@1', true, true),
      undefined,
      ['null', 'array'],
      { bsonType: ['null', 'string'] },
    ],
  ])('derives %s independently', (_name, field, required, bsonType, items) => {
    const result = deriveJsonSchema({ tags: field }, undefined, mongoCodecLookup);
    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      ...(required ? { required } : {}),
      properties: { tags: { bsonType, items } },
      additionalProperties: false,
    });
  });

  it.each([
    ['strict enum list', false, false, 'array', { bsonType: 'string', enum: ['user', 'admin'] }],
    [
      'nullable enum elements',
      false,
      true,
      'array',
      { bsonType: ['null', 'string'], enum: ['user', 'admin', null] },
    ],
    [
      'nullable enum list',
      true,
      false,
      ['null', 'array'],
      { bsonType: 'string', enum: ['user', 'admin'] },
    ],
    [
      'nullable enum list and elements',
      true,
      true,
      ['null', 'array'],
      { bsonType: ['null', 'string'], enum: ['user', 'admin', null] },
    ],
  ] as const)(
    'derives exact %s BSON shape',
    (_name, nullable, elementNullable, bsonType, items) => {
      const field = arrayEnumField('mongo/string@1', 'Role', nullable, elementNullable);
      const result = deriveJsonSchema({ roles: field }, undefined, mongoCodecLookup, {
        Role: { values: ['user', 'admin'] },
      });
      expect(result.jsonSchema).toEqual({
        bsonType: 'object',
        ...(nullable ? {} : { required: ['roles'] }),
        properties: {
          roles: {
            bsonType,
            items,
          },
        },
        additionalProperties: false,
      });
    },
  );

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

  it.each([
    ['strict value-object list', false, false, 'array'],
    ['nullable value-object elements', false, true, 'array'],
    ['nullable value-object list', true, false, ['null', 'array']],
    ['nullable value-object list and elements', true, true, ['null', 'array']],
  ] as const)('derives exact %s BSON shape', (_name, nullable, elementNullable, bsonType) => {
    const field = voArrayField('Tag', nullable, elementNullable);
    const valueObjects: Record<string, ContractValueObject> = {
      Tag: { fields: { label: scalarField('mongo/string@1') } },
    };
    const result = deriveJsonSchema({ tags: field }, valueObjects, mongoCodecLookup);
    const objectSchema = {
      bsonType: 'object',
      required: ['label'],
      properties: { label: { bsonType: 'string' } },
      additionalProperties: false,
    };
    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      ...(nullable ? {} : { required: ['tags'] }),
      properties: {
        tags: {
          bsonType,
          items: elementNullable ? { oneOf: [{ bsonType: 'null' }, objectSchema] } : objectSchema,
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
