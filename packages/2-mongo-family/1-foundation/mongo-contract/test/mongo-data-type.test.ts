import type { JsonValue } from '@internal/contract/types';
import { type DataType, dataType } from '@internal/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  assertMongoFieldTypeParams,
  isMongoDataType,
  type MongoTypeLookups,
  mongoDataType,
} from '../src/mongo-data-type';

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

describe('assertMongoFieldTypeParams', () => {
  const vector = mongoDataType('demo/vector', {
    bsonTypes: ['array'],
    params: type({ 'length?': 'number.integer >= 1' }),
  });
  const lookups = {
    codecLookup: {
      descriptorFor: (codecId: string) =>
        codecId === 'demo/vector@1' ? { dataType: vector.id } : undefined,
    },
    dataTypeLookup: { get: (id: string) => (id === vector.id ? vector : undefined) },
  } as unknown as MongoTypeLookups;
  const vectorField = (length: number) => ({
    nullable: false,
    type: { kind: 'scalar' as const, codecId: 'demo/vector@1', typeParams: { length } },
  });

  it('accepts type parameters the data type allows, and fields without any', () => {
    expect(() =>
      assertMongoFieldTypeParams(
        {
          app: {
            models: {
              Doc: {
                fields: {
                  embedding: vectorField(3),
                  name: { nullable: false, type: { kind: 'scalar', codecId: 'demo/text@1' } },
                },
              },
            },
          },
        },
        lookups,
      ),
    ).not.toThrow();
  });

  it.each([0, -1, 2.5])('refuses a model field whose length is %s', (length) => {
    expect(() =>
      assertMongoFieldTypeParams(
        { app: { models: { Doc: { fields: { embedding: vectorField(length) } } } } },
        lookups,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: expect.objectContaining({
          dataType: 'demo/vector',
          parameters: ['length'],
          modelName: 'Doc',
          fieldName: 'embedding',
        }),
      }),
    );
  });

  it('refuses a value object field the same way', () => {
    expect(() =>
      assertMongoFieldTypeParams(
        {
          app: {
            models: {},
            valueObjects: { Embedding: { fields: { values: vectorField(0) } } },
          },
        },
        lookups,
      ),
    ).toThrow(
      expect.objectContaining({
        meta: expect.objectContaining({ valueObjectName: 'Embedding', fieldName: 'values' }),
      }),
    );
  });
});
