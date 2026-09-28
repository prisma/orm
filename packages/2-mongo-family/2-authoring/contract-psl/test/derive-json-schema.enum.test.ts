import { describe, expect, it } from 'vitest';
import { deriveJsonSchema, type FieldValueSets } from '../src/derive-json-schema';
import {
  arrayEnumField,
  enumField,
  mongoCodecLookup,
  scalarField,
} from './derive-json-schema-helpers';

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
