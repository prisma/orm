import type { DataType } from '@internal/framework-components/codec';
import { isMongoDataType } from '@internal/mongo-contract/data-type';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptors } from '../src/core/codecs';
import { mongoDecimal128, mongoVector } from '../src/core/data-types';
import { mongoTargetDescriptorMetaRuntime } from '../src/core/descriptor-meta-runtime';

/** Each type's BSON types are the ones its codec stored values as before data types declared them. */
const EXPECTED_BSON_TYPES: Readonly<Record<string, readonly string[]>> = {
  'mongo/objectid': ['objectId'],
  'mongo/string': ['string'],
  'mongo/double': ['double'],
  'mongo/int32': ['int'],
  'mongo/bool': ['bool'],
  'mongo/date': ['date'],
  'mongo/calendar-date': ['date'],
  'mongo/time': ['string'],
  'mongo/duration': ['string'],
  'mongo/vector': ['array'],
  'mongo/int64': ['long'],
  'mongo/decimal128': ['decimal'],
  'mongo/binary': ['binData'],
  'mongo/json': ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  'mongo/bson': [],
};

/** The type names a `$jsonSchema` `bsonType` accepts, from the MongoDB manual's BSON types table. */
const JSON_SCHEMA_BSON_TYPES = new Set([
  'double',
  'string',
  'object',
  'array',
  'binData',
  'undefined',
  'objectId',
  'bool',
  'date',
  'null',
  'regex',
  'dbPointer',
  'javascript',
  'symbol',
  'javascriptWithScope',
  'int',
  'timestamp',
  'long',
  'decimal',
  'minKey',
  'maxKey',
  'number',
]);

const registered: readonly DataType[] = mongoTargetDescriptorMetaRuntime.dataTypes;

describe('the Mongo data type declarations', () => {
  it('registers exactly these data types', () => {
    expect(registered.map((type) => type.id).sort()).toEqual(
      Object.keys(EXPECTED_BSON_TYPES).sort(),
    );
  });

  it.each(registered.map((type) => [type.id, type] as const))(
    '%s declares its BSON types',
    (id, type) => {
      expect(EXPECTED_BSON_TYPES).toHaveProperty([id]);
      expect(isMongoDataType(type) ? type.mongo.bsonTypes : undefined).toEqual(
        EXPECTED_BSON_TYPES[id],
      );
    },
  );

  it('declares these casts, each by the type that receives the value', () => {
    expect(
      Object.fromEntries(
        registered.map((type) => [
          type.id,
          { casts: Object.keys(type.casts), listCast: type.listCast?.of },
        ]),
      ),
    ).toEqual({
      'mongo/objectid': { casts: ['mongo/string'], listCast: undefined },
      'mongo/string': { casts: [], listCast: undefined },
      'mongo/double': {
        casts: ['mongo/int32', 'mongo/int64', 'mongo/decimal128'],
        listCast: undefined,
      },
      'mongo/int32': { casts: [], listCast: undefined },
      'mongo/bool': { casts: [], listCast: undefined },
      'mongo/date': { casts: [], listCast: undefined },
      'mongo/calendar-date': { casts: ['mongo/string', 'mongo/date'], listCast: undefined },
      'mongo/time': { casts: ['mongo/string'], listCast: undefined },
      'mongo/duration': { casts: ['mongo/string'], listCast: undefined },
      'mongo/vector': {
        casts: [],
        listCast: ['mongo/int32', 'mongo/int64', 'mongo/decimal128', 'mongo/double'],
      },
      'mongo/int64': { casts: ['mongo/int32'], listCast: undefined },
      'mongo/decimal128': { casts: ['mongo/int32', 'mongo/int64'], listCast: undefined },
      'mongo/binary': { casts: [], listCast: undefined },
      'mongo/json': { casts: [], listCast: undefined },
      'mongo/bson': { casts: [], listCast: undefined },
    });
  });

  it('declares only BSON types a collection validator can name', () => {
    const unnamed = registered.flatMap((type) =>
      isMongoDataType(type)
        ? type.mongo.bsonTypes.filter((name) => !JSON_SCHEMA_BSON_TYPES.has(name))
        : [],
    );
    expect(unnamed).toEqual([]);
  });

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

describe('the equality of mongo/decimal128 values', () => {
  it('holds values equal that differ only in scale', () => {
    expect(['1.50', '1.5', '2'].map((json) => mongoDecimal128.equalityKey?.(json))).toEqual([
      '1.5',
      '1.5',
      '2',
    ]);
  });
});

describe("each Mongo codec's equality-key flag", () => {
  it('is declared by mongo/decimal128@1 only, whose data type has an equality key', () => {
    const flagged = mongoCodecDescriptors.filter(
      (descriptor) => descriptor.keepsWrittenForm === true,
    );
    expect({
      flagged: flagged.map((descriptor) => descriptor.codecId),
      keyed: mongoDecimal128.equalityKey !== undefined,
      renderingLiterals: flagged
        .filter((descriptor) => descriptor.renderValueLiteral !== undefined)
        .map((descriptor) => descriptor.codecId),
    }).toEqual({ flagged: ['mongo/decimal128@1'], keyed: true, renderingLiterals: [] });
  });
});
