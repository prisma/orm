import type { JsonValue } from '@internal/contract/types';
import { type DataType, dataType } from '@internal/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { isMongoDataType, mongoDataType } from '../src/mongo-data-type';

const valueMethods = {
  fromContract: expect.any(Function),
  toContract: expect.any(Function),
  withParams: expect.any(Function),
};

describe('mongoDataType', () => {
  it('declares a data type with the BSON types it is stored as', () => {
    const declared = mongoDataType('demo/number', {
      read: (json) => json,
      bsonTypes: ['int', 'long'],
    });
    expect(declared).toEqual({
      id: 'demo/number',
      casts: {},
      mongo: { bsonTypes: ['int', 'long'] },
      ...valueMethods,
    });
  });

  it('allows a type stored as no one BSON type', () => {
    expect(
      mongoDataType('demo/any', { read: (json) => json, bsonTypes: [] }).mongo.bsonTypes,
    ).toEqual([]);
  });

  it('keeps the parameter schema and the casts', () => {
    const params = type({ 'length?': 'number.integer >= 1' });
    const text = mongoDataType('demo/text', { read: (json) => json, bsonTypes: ['string'] });
    const declared = mongoDataType('demo/vector', {
      read: (json) => json,
      bsonTypes: ['array'],
      params,
      casts: { [text.id]: (value) => value },
    });
    expect(declared.params).toBe(params);
    expect(declared.casts[text.id]?.('x')).toBe('x');
  });

  it('keeps every field of the framework declaration', () => {
    const text = mongoDataType('demo/text', { read: (json) => json, bsonTypes: ['string'] });
    const casts = { [text.id]: (value: JsonValue) => value };
    const toCanonicalForm = (value: JsonValue) => value;
    const declared = mongoDataType('demo/kept', {
      read: (json) => json,
      bsonTypes: ['string'],
      casts,
      toCanonicalForm,
    });
    const { mongo: _mongo, ...frameworkFields } = declared;
    expect(frameworkFields).toEqual({
      ...dataType('demo/kept', { read: (json) => json, casts, toCanonicalForm }),
      ...valueMethods,
    });
  });

  it('validates its id like every data type', () => {
    expect(() => mongoDataType('demo/number@1', { read: (json) => json, bsonTypes: [] })).toThrow(
      /is not a data type id/,
    );
  });
});

describe('isMongoDataType', () => {
  it('recognises a Mongo data type', () => {
    expect(
      isMongoDataType(mongoDataType('demo/number', { read: (json) => json, bsonTypes: ['int'] })),
    ).toBe(true);
  });

  it('does not claim a plain data type', () => {
    expect(isMongoDataType(dataType('demo/plain', { read: (json) => json }))).toBe(false);
  });

  it('does not claim a data type of another family', () => {
    expect(
      isMongoDataType({ ...dataType('demo/sql', { read: (json) => json }), sql: {} } as DataType),
    ).toBe(false);
  });
});
