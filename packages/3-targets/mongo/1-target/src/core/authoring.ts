import {
  type AuthoringTypeNamespace,
  temporalTypeAliases,
} from '@internal/framework-components/authoring';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_BSON_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_INT64_NUMBER_CODEC_ID,
  MONGO_JSON_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
  MONGO_VECTOR_CODEC_ID,
} from './codec-ids';

/**
 * The MongoDB scalar types as type constructors, which PSL writes as field types and the TypeScript builder calls as `type.X()`. Each names a codec; the collection validator reads the BSON types from the data type the codec represents, not from the constructor.
 */
export const mongoScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Text, stored as BSON string.',
    output: { codecId: MONGO_STRING_CODEC_ID },
  },
  Int32: {
    kind: 'typeConstructor',
    documentation: 'A signed 32-bit integer, stored as BSON int.',
    output: { codecId: MONGO_INT32_CODEC_ID },
  },
  Bool: {
    kind: 'typeConstructor',
    documentation: 'A true or false value, stored as BSON bool.',
    output: { codecId: MONGO_BOOLEAN_CODEC_ID },
  },
  Date: {
    kind: 'typeConstructor',
    documentation: 'A date and time with millisecond precision, stored as BSON date.',
    output: { codecId: MONGO_DATE_CODEC_ID },
  },
  ObjectId: {
    kind: 'typeConstructor',
    documentation: 'A 12-byte MongoDB identifier, stored as BSON objectId.',
    output: { codecId: MONGO_OBJECTID_CODEC_ID },
  },
  Double: {
    kind: 'typeConstructor',
    documentation: 'A double-precision floating-point number, stored as BSON double.',
    output: { codecId: MONGO_DOUBLE_CODEC_ID },
  },
  Int64: {
    kind: 'typeConstructor',
    documentation: 'A signed 64-bit integer read as a bigint, stored as BSON long.',
    output: { codecId: MONGO_INT64_CODEC_ID },
  },
  Int64Number: {
    kind: 'typeConstructor',
    documentation:
      'A signed 64-bit integer read as a JavaScript number within its safe integer range, stored as BSON long.',
    output: { codecId: MONGO_INT64_NUMBER_CODEC_ID },
  },
  Decimal128: {
    kind: 'typeConstructor',
    documentation:
      'A 128-bit decimal read as decimal text without an exponent, stored as BSON decimal.',
    output: { codecId: MONGO_DECIMAL128_CODEC_ID },
  },
  Binary: {
    kind: 'typeConstructor',
    documentation: 'Bytes read as a Uint8Array, stored as BSON binData.',
    output: { codecId: MONGO_BINARY_CODEC_ID },
  },
  Json: {
    kind: 'typeConstructor',
    documentation:
      'A JSON value, stored as BSON object, array, string, double, int, long, bool or null; the collection validator admits only those types at the top level, and the codec refuses anything else at any depth.',
    output: { codecId: MONGO_JSON_CODEC_ID },
  },
  Bson: {
    kind: 'typeConstructor',
    documentation:
      'Any BSON value, read as BsonValue; the collection validator does not constrain it.',
    output: { codecId: MONGO_BSON_CODEC_ID },
  },
  Vector: {
    kind: 'typeConstructor',
    documentation:
      'A list of finite numbers, stored as BSON array, as a vector search index reads it. With a length, it is read as Vector<length>.',
    args: [{ kind: 'value', dataType: 'mongo/int32', name: 'length', optional: true }],
    output: {
      codecId: MONGO_VECTOR_CODEC_ID,
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'Deprecated: use Int32. A signed 32-bit integer, stored as BSON int.',
    output: { codecId: MONGO_INT32_CODEC_ID },
    deprecated: { replacement: 'Int32' },
  },
  Float: {
    kind: 'typeConstructor',
    documentation:
      'Deprecated: use Double. A double-precision floating-point number, stored as BSON double.',
    output: { codecId: MONGO_DOUBLE_CODEC_ID },
    deprecated: { replacement: 'Double' },
  },
  Boolean: {
    kind: 'typeConstructor',
    documentation: 'Deprecated: use Bool. A true or false value, stored as BSON bool.',
    output: { codecId: MONGO_BOOLEAN_CODEC_ID },
    deprecated: { replacement: 'Bool' },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation:
      'Deprecated: use Date. A date and time with millisecond precision, stored as BSON date.',
    output: { codecId: MONGO_DATE_CODEC_ID },
    deprecated: { replacement: 'Date' },
  },
} as const satisfies AuthoringTypeNamespace;

export const mongoAuthoringTypes = {
  ...mongoScalarAuthoringTypes,
  temporal: temporalTypeAliases({ codecId: MONGO_DATE_CODEC_ID }, 'a JavaScript Date'),
} as const satisfies AuthoringTypeNamespace;
