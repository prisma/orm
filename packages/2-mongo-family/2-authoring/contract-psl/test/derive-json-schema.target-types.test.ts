import { describe, expect, it } from 'vitest';
import { deriveJsonSchema } from '../src/derive-json-schema';
import { arrayField, mongoCodecLookup, scalarField } from './derive-json-schema-helpers';

describe('deriveJsonSchema BSON type lists', () => {
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

  it('admits any value in a field whose codec has no BSON type', () => {
    const result = deriveJsonSchema(
      {
        _id: scalarField('mongo/objectId@1'),
        meta: scalarField('test/unconstrained@1'),
        notes: scalarField('test/unconstrained@1', true),
        tags: arrayField('test/unconstrained@1'),
      },
      undefined,
      mongoCodecLookup,
    );

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'meta', 'tags'],
      properties: {
        _id: { bsonType: 'objectId' },
        meta: {},
        notes: {},
        tags: { bsonType: 'array', items: {} },
      },
      additionalProperties: false,
    });
  });

  it.each([
    [false, false, 'array'],
    [false, true, 'array'],
    [true, false, ['null', 'array']],
    [true, true, ['null', 'array']],
  ] as const)(
    'derives unconstrained list nullable=%s elementNullable=%s',
    (nullable, elementNullable, bsonType) => {
      const result = deriveJsonSchema(
        { tags: arrayField('test/unconstrained@1', nullable, elementNullable) },
        undefined,
        mongoCodecLookup,
      );

      expect(result.jsonSchema).toEqual({
        bsonType: 'object',
        ...(nullable ? {} : { required: ['tags'] }),
        properties: { tags: { bsonType, items: {} } },
        additionalProperties: false,
      });
    },
  );

  it('leaves a Bson field unconstrained when required, nullable or a list', () => {
    const result = deriveJsonSchema(
      {
        raw: scalarField('mongo/bson@1'),
        maybe: scalarField('mongo/bson@1', true),
        many: arrayField('mongo/bson@1'),
      },
      undefined,
      mongoCodecLookup,
    );
    expect(result.jsonSchema['properties']).toEqual({
      raw: {},
      maybe: {},
      many: { bsonType: 'array', items: {} },
    });
  });

  describe('a Json field', () => {
    const jsonBsonTypes = ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'];

    it('admits the JSON-representable BSON types, null included, when required', () => {
      const result = deriveJsonSchema(
        { payload: scalarField('mongo/json@1') },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema).toMatchObject({
        required: ['payload'],
        properties: { payload: { bsonType: jsonBsonTypes } },
      });
    });

    it('admits the same types when nullable, without a second null', () => {
      const result = deriveJsonSchema(
        { payload: scalarField('mongo/json@1', true) },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({ payload: { bsonType: jsonBsonTypes } });
    });

    it('admits the same types for each item of a list', () => {
      const result = deriveJsonSchema(
        { payloads: arrayField('mongo/json@1') },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({
        payloads: { bsonType: 'array', items: { bsonType: jsonBsonTypes } },
      });
    });
  });

  describe('a codec with several BSON types', () => {
    it('lists every type for a required field', () => {
      const result = deriveJsonSchema(
        { count: scalarField('test/int-or-long@1') },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({ count: { bsonType: ['int', 'long'] } });
    });

    it('prepends null for a nullable field', () => {
      const result = deriveJsonSchema(
        { count: scalarField('test/int-or-long@1', true) },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({
        count: { bsonType: ['null', 'int', 'long'] },
      });
    });

    it('does not repeat null for a nullable field whose types already include it', () => {
      const result = deriveJsonSchema(
        { count: scalarField('test/number-or-null@1', true) },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({ count: { bsonType: ['null', 'int'] } });
    });

    it('lists every type for the items of a list field', () => {
      const result = deriveJsonSchema(
        { counts: arrayField('test/int-or-long@1') },
        undefined,
        mongoCodecLookup,
      );
      expect(result.jsonSchema['properties']).toEqual({
        counts: { bsonType: 'array', items: { bsonType: ['int', 'long'] } },
      });
    });
  });
});
