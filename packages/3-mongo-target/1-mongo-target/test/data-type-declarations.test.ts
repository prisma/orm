import type { DataType } from '@internal/framework-components/codec';
import { isMongoDataType } from '@internal/mongo-contract/data-type';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';
import { mongoVector } from '../src/core/data-types';
import { mongoTargetDescriptorMetaRuntime } from '../src/core/descriptor-meta-runtime';

/** Design 2.6: each type's BSON types are the ones its codec stored values as before slice 1. */
const EXPECTED_BSON_TYPES: Readonly<Record<string, readonly string[]>> = {
  'mongo/objectid': ['objectId'],
  'mongo/string': ['string'],
  'mongo/double': ['double'],
  'mongo/int32': ['int'],
  'mongo/bool': ['bool'],
  'mongo/date': ['date'],
  'mongo/vector': ['vector'],
  'mongo/int64': ['long'],
  'mongo/decimal128': ['decimal'],
  'mongo/binary': ['binData'],
  'mongo/json': ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  'mongo/bson': [],
};

const registered: readonly DataType[] = mongoTargetDescriptorMetaRuntime.dataTypes;

describe('the Mongo data type declarations', () => {
  it('registers exactly the data types design 2.6 declares', () => {
    expect(registered.map((type) => type.id).sort()).toEqual(
      Object.keys(EXPECTED_BSON_TYPES).sort(),
    );
  });

  it.each(registered.map((type) => [type.id, type] as const))(
    '%s is declared as design 2.6 says',
    (id, type) => {
      expect(EXPECTED_BSON_TYPES).toHaveProperty([id]);
      expect(isMongoDataType(type) ? type.mongo.bsonTypes : undefined).toEqual(
        EXPECTED_BSON_TYPES[id],
      );
      expect(Object.keys(type.casts)).toEqual([]);
      expect(type.listCast).toBeUndefined();
    },
  );

  it('declares a parameter only on the vector, whose length is optional and 1 or more', () => {
    expect(registered.filter((type) => type.params !== undefined)).toEqual([mongoVector]);
    const valid = (params: unknown) => !(mongoVector.params?.(params) instanceof type.errors);
    expect([{}, { length: 1 }].map(valid)).toEqual([true, true]);
    expect([{ length: 0 }, { length: 1.5 }].map(valid)).toEqual([false, false]);
  });
});

describe('the parameter schema of every Mongo codec', () => {
  it.each(mongoCodecDescriptors.map((descriptor) => [descriptor.codecId, descriptor] as const))(
    '%s uses its data type’s parameter schema',
    (_codecId, descriptor) => {
      const type = registered.find((candidate) => candidate.id === descriptor.dataType);
      expect(type).toBeDefined();
      expect(descriptor.paramsSchema).toBe(type?.params);
      expect(descriptor.isParameterized).toBe(type?.params !== undefined);
    },
  );
});
