/**
 * The data types this target owns, one per BSON type its codecs represent, each with the BSON types
 * a value of it is stored as, and the reader of its stored form. None of them casts from another and
 * none is written in a contract source yet: this target's own types are the subject of a later piece of work. ADR 254.
 */

import type { DataType } from '@internal/framework-components/codec';
import {
  readJsonBoolean,
  readJsonFloat,
  readJsonString,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { type as arktype } from 'arktype';
import { readBsonJson } from './bson-codec-helpers';
import {
  readBinaryJson,
  readDateJson,
  readDecimal128Json,
  readInt32Json,
  readInt64Json,
  readObjectIdJson,
  readVectorJson,
} from './bson-scalar-helpers';

/** The vector's dimension: the TypeScript type `Vector<n>` and the type's reader read it. */
export const mongoVectorParams = arktype({ 'length?': 'number.integer >= 1' });

export const mongoObjectId = mongoDataType('mongo/objectid', {
  read: (json) => readObjectIdJson('mongo/objectid', json),
  bsonTypes: ['objectId'],
});
export const mongoString = mongoDataType('mongo/string', {
  read: (json) => readJsonString('mongo/string', json),
  bsonTypes: ['string'],
});
export const mongoDouble = mongoDataType('mongo/double', {
  read: (json) => {
    readJsonFloat('mongo/double', json);
    return json;
  },
  bsonTypes: ['double'],
});
export const mongoInt32 = mongoDataType('mongo/int32', {
  read: (json) => readInt32Json('mongo/int32', json),
  bsonTypes: ['int'],
});
export const mongoBool = mongoDataType('mongo/bool', {
  read: (json) => readJsonBoolean('mongo/bool', json),
  bsonTypes: ['bool'],
});
export const mongoDate = mongoDataType('mongo/date', {
  read: (json) => readDateJson('mongo/date', json),
  bsonTypes: ['date'],
});
export const mongoVector = mongoDataType('mongo/vector', {
  read: (json, params) =>
    readVectorJson(
      'mongo/vector',
      json,
      typeof params['length'] === 'number' ? params['length'] : undefined,
    ),
  bsonTypes: ['vector'],
  params: mongoVectorParams,
});
export const mongoInt64 = mongoDataType('mongo/int64', {
  read: (json) => readInt64Json('mongo/int64', json),
  bsonTypes: ['long'],
});
export const mongoDecimal128 = mongoDataType('mongo/decimal128', {
  read: (json) => readDecimal128Json('mongo/decimal128', json),
  bsonTypes: ['decimal'],
});
export const mongoBinary = mongoDataType('mongo/binary', {
  read: (json) => readBinaryJson('mongo/binary', json),
  bsonTypes: ['binData'],
});
export const mongoJson = mongoDataType('mongo/json', {
  read: (json) => json,
  bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
});
export const mongoBson = mongoDataType('mongo/bson', {
  read: (json) => {
    readBsonJson('mongo/bson', json);
    return json;
  },
  bsonTypes: [],
});

export const mongoDataTypes: readonly DataType[] = [
  mongoObjectId,
  mongoString,
  mongoDouble,
  mongoInt32,
  mongoBool,
  mongoDate,
  mongoVector,
  mongoInt64,
  mongoDecimal128,
  mongoBinary,
  mongoJson,
  mongoBson,
];
