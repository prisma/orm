import { type ContractValueObject, crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  derive,
  embedMany,
  model,
  polymorphicRootValidator,
  rootValidator,
} from './collection-validator-helpers';
import {
  arrayEnumField,
  arrayField,
  scalarField,
  voArrayField,
  voField,
} from './derive-json-schema-helpers';

describe('deriveCollectionValidators — fields', () => {
  it('maps String, Int32, Bool, Date, ObjectId to correct BSON types', () => {
    const result = rootValidator({
      name: scalarField('mongo/string@1'),
      age: scalarField('mongo/int32@1'),
      active: scalarField('mongo/bool@1'),
      created: scalarField('mongo/date@1'),
      _id: scalarField('mongo/objectId@1'),
    });

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
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      email: scalarField('mongo/string@1', true),
    });

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
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      tags: arrayField('mongo/string@1'),
    });

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
    const result = rootValidator({ tags: field });
    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', ...(required ?? [])],
      properties: { _id: { bsonType: 'objectId' }, tags: { bsonType, items } },
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
      const result = rootValidator(
        { roles: field },
        {
          valueSets: {
            Role: { values: ['user', 'admin'] },
          },
        },
      );
      expect(result.jsonSchema).toEqual({
        bsonType: 'object',
        required: nullable ? ['_id'] : ['_id', 'roles'],
        properties: {
          _id: { bsonType: 'objectId' },
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

    const result = rootValidator(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      { valueObjects },
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

    const result = rootValidator(
      { _id: scalarField('mongo/objectId@1'), tags: voArrayField('Tag') },
      { valueObjects },
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
    const result = rootValidator({ tags: field }, { valueObjects });
    const objectSchema = {
      bsonType: 'object',
      required: ['label'],
      properties: { label: { bsonType: 'string' } },
      additionalProperties: false,
    };
    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: nullable ? ['_id'] : ['_id', 'tags'],
      properties: {
        _id: { bsonType: 'objectId' },
        tags: {
          bsonType,
          items: elementNullable ? { oneOf: [{ bsonType: 'null' }, objectSchema] } : objectSchema,
        },
      },
      additionalProperties: false,
    });
  });

  it('derives a schema that requires only the document id from an empty field set', () => {
    const result = rootValidator({});

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id'],
      properties: { _id: { bsonType: 'objectId' } },
      additionalProperties: false,
    });
  });

  it('handles mixed nullable and non-nullable fields', () => {
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      name: scalarField('mongo/string@1'),
      bio: scalarField('mongo/string@1', true),
      age: scalarField('mongo/int32@1'),
    });

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

  it('refuses a field whose codec has no MongoDB data type, rather than leave it out', () => {
    expect(() =>
      rootValidator({
        _id: scalarField('mongo/objectId@1'),
        custom: scalarField('custom/unknown@1'),
      }),
    ).toThrow('Field codec "custom/unknown@1" has no MongoDB data type');
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

    const result = rootValidator(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      { valueObjects },
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
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      price: scalarField('mongo/double@1'),
    });

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

    const result = rootValidator(
      { _id: scalarField('mongo/objectId@1'), address: voField('Address') },
      { valueObjects },
    );

    const properties = result.jsonSchema['properties'] as Record<string, Record<string, unknown>>;
    const nested = properties['address'] as Record<string, unknown>;
    const nestedProps = nested['properties'] as Record<string, unknown>;
    expect(nestedProps).not.toHaveProperty('_id');
    expect(nested['additionalProperties']).toBe(false);
  });

  it('emits the _id property from the declared field', () => {
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      name: scalarField('mongo/string@1'),
    });

    const properties = result.jsonSchema['properties'] as Record<string, unknown>;
    expect(properties['_id']).toEqual({ bsonType: 'objectId' });
  });
});

describe('deriveCollectionValidators — variants', () => {
  it('includes discriminatorField in required for each oneOf branch', () => {
    const result = polymorphicRootValidator(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [
        { discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } },
        { discriminatorValue: 'Cat', fields: { indoor: scalarField('mongo/bool@1') } },
      ],
    );

    const oneOf = result.jsonSchema['oneOf'] as Record<string, unknown>[];
    expect(oneOf).toHaveLength(2);
    for (const branch of oneOf) {
      expect(branch['required']).toContain('_type');
    }
  });

  it('emits oneOf branch even for single variant with no extra fields', () => {
    const result = polymorphicRootValidator(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [{ discriminatorValue: 'OnlyVariant', fields: {} }],
    );

    const oneOf = result.jsonSchema['oneOf'] as Record<string, unknown>[];
    expect(oneOf).toHaveLength(1);
    expect(oneOf[0]).toMatchObject({
      properties: { _type: { enum: ['OnlyVariant'] } },
      required: ['_type'],
    });
  });

  it('closes each oneOf branch with additionalProperties:false and lists base + variant fields', () => {
    const result = polymorphicRootValidator(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [
        { discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } },
        { discriminatorValue: 'Cat', fields: { indoor: scalarField('mongo/bool@1') } },
      ],
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
    const result = polymorphicRootValidator(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      '_type',
      [{ discriminatorValue: 'Dog', fields: { breed: scalarField('mongo/string@1') } }],
    );

    expect(result.jsonSchema).not.toHaveProperty('additionalProperties');
    expect(result.jsonSchema).toHaveProperty('properties._id');
  });

  it('repeats the base _id into every branch', () => {
    const result = polymorphicRootValidator(
      { _id: scalarField('mongo/objectId@1'), name: scalarField('mongo/string@1') },
      'kind',
      [{ discriminatorValue: 'a', fields: { extra: scalarField('mongo/string@1') } }],
    );

    expect(result.jsonSchema).toHaveProperty('properties._id');
    const oneOf = result.jsonSchema['oneOf'] as Record<string, Record<string, unknown>>[];
    const branchProps = oneOf[0]!['properties'] as Record<string, unknown>;
    expect(branchProps['_id']).toEqual({ bsonType: 'objectId' });
  });
});

describe('deriveCollectionValidators — stored names', () => {
  it('describes each field under its stored name', () => {
    const validators = derive({
      roots: { items: crossRef('Item') },
      models: {
        Item: model(
          { id: scalarField('mongo/objectId@1'), title: scalarField('mongo/string@1', true) },
          { storage: { fields: { id: { field: '_id' }, title: { field: 'display_title' } } } },
        ),
      },
    });
    expect(validators['items']?.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {
        _id: { bsonType: 'objectId' },
        display_title: { bsonType: ['null', 'string'] },
      },
      required: ['_id'],
      additionalProperties: false,
    });
  });

  it('names the discriminator and variant fields by their stored names', () => {
    const validators = derive({
      roots: { items: crossRef('Item') },
      models: {
        Item: model(
          { id: scalarField('mongo/objectId@1'), kind: scalarField('mongo/string@1') },
          {
            storage: { fields: { id: { field: '_id' }, kind: { field: '_kind' } } },
            discriminator: { field: 'kind' },
            variants: { dog: crossRef('Dog') },
          },
        ),
        Dog: model(
          { breed: scalarField('mongo/string@1') },
          { storage: { fields: { breed: { field: 'dog_breed' } } }, base: crossRef('Item') },
        ),
      },
    });
    expect(validators['items']?.jsonSchema).toEqual({
      bsonType: 'object',
      properties: { _id: { bsonType: 'objectId' }, _kind: { bsonType: 'string' } },
      required: ['_id', '_kind'],
      oneOf: [
        {
          properties: {
            _id: { bsonType: 'objectId' },
            _kind: { enum: ['dog'] },
            dog_breed: { bsonType: 'string' },
          },
          required: ['_kind', 'dog_breed'],
          additionalProperties: false,
        },
      ],
    });
  });
});

describe('deriveCollectionValidators — embed stored names', () => {
  it('describes an embedded model under its relation stored name, with its fields under their stored names', () => {
    const validators = derive({
      roots: { items: crossRef('Item') },
      models: {
        Item: model(
          { id: scalarField('mongo/objectId@1') },
          {
            relations: { notes: embedMany('Note') },
            storage: {
              fields: { id: { field: '_id' } },
              relations: { notes: { field: 'item_notes' } },
            },
          },
        ),
        Note: model(
          { text: scalarField('mongo/string@1') },
          { storage: { fields: { text: { field: 'note_text' } } }, owner: 'Item' },
        ),
      },
    });
    expect(validators['items']?.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {
        _id: { bsonType: 'objectId' },
        item_notes: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: { note_text: { bsonType: 'string' } },
            required: ['note_text'],
            additionalProperties: false,
          },
        },
      },
      required: ['_id'],
      additionalProperties: false,
    });
  });
});
