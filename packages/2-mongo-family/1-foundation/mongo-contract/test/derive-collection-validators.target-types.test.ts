import { describe, expect, it } from 'vitest';
import { rootValidator } from './collection-validator-helpers';
import { arrayField, scalarField } from './derive-json-schema-helpers';

describe('deriveCollectionValidators — BSON type lists', () => {
  it('maps Int64, Decimal128 and Binary to long, decimal and binData', () => {
    const result = rootValidator({
      views: scalarField('mongo/int64@1'),
      price: scalarField('mongo/decimal128@1'),
      thumbnail: scalarField('mongo/binary@1'),
    });

    expect(result.jsonSchema['properties']).toEqual({
      _id: { bsonType: 'objectId' },
      views: { bsonType: 'long' },
      price: { bsonType: 'decimal' },
      thumbnail: { bsonType: 'binData' },
    });
  });

  it('admits any value in a field whose codec has no BSON type', () => {
    const result = rootValidator({
      _id: scalarField('mongo/objectId@1'),
      meta: scalarField('test/unconstrained@1'),
      notes: scalarField('test/unconstrained@1', true),
      tags: arrayField('test/unconstrained@1'),
    });

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
      const result = rootValidator({
        tags: arrayField('test/unconstrained@1', nullable, elementNullable),
      });

      expect(result.jsonSchema).toEqual({
        bsonType: 'object',
        required: nullable ? ['_id'] : ['_id', 'tags'],
        properties: { _id: { bsonType: 'objectId' }, tags: { bsonType, items: {} } },
        additionalProperties: false,
      });
    },
  );

  it('leaves a Bson field unconstrained when required, nullable or a list', () => {
    const result = rootValidator({
      raw: scalarField('mongo/bson@1'),
      maybe: scalarField('mongo/bson@1', true),
      many: arrayField('mongo/bson@1'),
    });
    expect(result.jsonSchema['properties']).toEqual({
      _id: { bsonType: 'objectId' },
      raw: {},
      maybe: {},
      many: { bsonType: 'array', items: {} },
    });
  });

  describe('a Json field', () => {
    const jsonBsonTypes = ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'];

    it('admits the JSON-representable BSON types, null included, when required', () => {
      const result = rootValidator({ payload: scalarField('mongo/json@1') });
      expect(result.jsonSchema).toMatchObject({
        required: ['_id', 'payload'],
        properties: { payload: { bsonType: jsonBsonTypes } },
      });
    });

    it('admits the same types when nullable, without a second null', () => {
      const result = rootValidator({ payload: scalarField('mongo/json@1', true) });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        payload: { bsonType: jsonBsonTypes },
      });
    });

    it('admits the same types for each item of a list', () => {
      const result = rootValidator({ payloads: arrayField('mongo/json@1') });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        payloads: { bsonType: 'array', items: { bsonType: jsonBsonTypes } },
      });
    });
  });

  describe('a codec with several BSON types', () => {
    it('lists every type for a required field', () => {
      const result = rootValidator({ count: scalarField('test/int-or-long@1') });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        count: { bsonType: ['int', 'long'] },
      });
    });

    it('prepends null for a nullable field', () => {
      const result = rootValidator({ count: scalarField('test/int-or-long@1', true) });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        count: { bsonType: ['null', 'int', 'long'] },
      });
    });

    it('does not repeat null for a nullable field whose types already include it', () => {
      const result = rootValidator({ count: scalarField('test/number-or-null@1', true) });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        count: { bsonType: ['null', 'int'] },
      });
    });

    it('lists every type for the items of a list field', () => {
      const result = rootValidator({ counts: arrayField('test/int-or-long@1') });
      expect(result.jsonSchema['properties']).toEqual({
        _id: { bsonType: 'objectId' },
        counts: { bsonType: 'array', items: { bsonType: ['int', 'long'] } },
      });
    });
  });
});
