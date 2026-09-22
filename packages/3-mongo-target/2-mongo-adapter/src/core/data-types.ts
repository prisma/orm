/**
 * The data types this target owns, one per BSON type its codecs represent. None of them casts from
 * another and none is written in a contract source yet: this target's own types are the subject of
 * a later piece of work. ADR 254.
 */

import { type DataType, dataType } from '@internal/framework-components/codec';

export const mongoObjectId: DataType = dataType('mongo/objectid', {});
export const mongoString: DataType = dataType('mongo/string', {});
export const mongoDouble: DataType = dataType('mongo/double', {});
export const mongoInt32: DataType = dataType('mongo/int32', {});
export const mongoBool: DataType = dataType('mongo/bool', {});
export const mongoDate: DataType = dataType('mongo/date', {});
export const mongoVector: DataType = dataType('mongo/vector', {});

export const mongoDataTypes: readonly DataType[] = [
  mongoObjectId,
  mongoString,
  mongoDouble,
  mongoInt32,
  mongoBool,
  mongoDate,
  mongoVector,
];
