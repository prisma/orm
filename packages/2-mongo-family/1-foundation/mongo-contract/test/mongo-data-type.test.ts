import type { JsonValue } from '@internal/contract/types';
import { type DataType, dataType } from '@internal/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { isMongoDataType, mongoDataType } from '../src/mongo-data-type';

describe('mongoDataType', () => {
  it('declares a data type with the BSON types it is stored as', () => {
    const declared = mongoDataType('demo/number', { bsonTypes: ['int', 'long'] });
    expect(declared).toEqual({
      id: 'demo/number',
      casts: {},
      mongo: { bsonTypes: ['int', 'long'] },
    });
  });

  it('allows a type stored as no one BSON type', () => {
    expect(mongoDataType('demo/any', { bsonTypes: [] }).mongo.bsonTypes).toEqual([]);
  });

  it('keeps the parameter schema and the casts', () => {
    const params = type({ 'length?': 'number.integer >= 1' });
    const text = mongoDataType('demo/text', { bsonTypes: ['string'] });
    const declared = mongoDataType('demo/vector', {
      bsonTypes: ['array'],
      params,
      casts: { [text.id]: (value) => value },
    });
    expect(declared.params).toBe(params);
    expect(declared.casts[text.id]?.('x')).toBe('x');
  });

  it('keeps every field of the framework declaration', () => {
    const text = mongoDataType('demo/text', { bsonTypes: ['string'] });
    const casts = { [text.id]: (value: JsonValue) => value };
    const toCanonicalForm = (value: JsonValue) => value;
    const declared = mongoDataType('demo/kept', { bsonTypes: ['string'], casts, toCanonicalForm });
    expect(Object.fromEntries(Object.entries(declared).filter(([key]) => key !== 'mongo'))).toEqual(
      dataType('demo/kept', { casts, toCanonicalForm }),
    );
  });

  it('validates its id like every data type', () => {
    expect(() => mongoDataType('demo/number@1', { bsonTypes: [] })).toThrow(
      /is not a data type id/,
    );
  });
});

describe('isMongoDataType', () => {
  it('recognises a Mongo data type', () => {
    expect(isMongoDataType(mongoDataType('demo/number', { bsonTypes: ['int'] }))).toBe(true);
  });

  it('does not claim a plain data type', () => {
    expect(isMongoDataType(dataType('demo/plain', {}))).toBe(false);
  });

  it('does not claim a data type of another family', () => {
    expect(isMongoDataType({ ...dataType('demo/sql', {}), sql: {} } as DataType)).toBe(false);
  });
});
