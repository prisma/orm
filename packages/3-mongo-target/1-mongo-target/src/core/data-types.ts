/**
 * The data types this target owns, one per BSON type its codecs represent, each with the BSON types
 * a value of it is stored as. None of them casts from another and none is written in a contract
 * source yet: this target's own types are the subject of a later piece of work. ADR 254.
 */

import type { DataType } from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { type as arktype } from 'arktype';

/** The vector's dimension, which only the TypeScript type `Vector<n>` reads. */
export const mongoVectorParams = arktype({ 'length?': 'number.integer >= 1' });

export const mongoObjectId = mongoDataType('mongo/objectid', { bsonTypes: ['objectId'] });
export const mongoString = mongoDataType('mongo/string', { bsonTypes: ['string'] });
export const mongoDouble = mongoDataType('mongo/double', { bsonTypes: ['double'] });
export const mongoInt32 = mongoDataType('mongo/int32', { bsonTypes: ['int'] });
export const mongoBool = mongoDataType('mongo/bool', { bsonTypes: ['bool'] });
export const mongoDate = mongoDataType('mongo/date', { bsonTypes: ['date'] });
export const mongoVector = mongoDataType('mongo/vector', {
  bsonTypes: ['vector'],
  params: mongoVectorParams,
});
export const mongoInt64 = mongoDataType('mongo/int64', { bsonTypes: ['long'] });
export const mongoDecimal128 = mongoDataType('mongo/decimal128', { bsonTypes: ['decimal'] });
export const mongoBinary = mongoDataType('mongo/binary', { bsonTypes: ['binData'] });
export const mongoJson = mongoDataType('mongo/json', {
  bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
});
export const mongoBson = mongoDataType('mongo/bson', { bsonTypes: [] });

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
