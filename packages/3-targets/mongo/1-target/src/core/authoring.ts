import {
  type AuthoringTypeNamespace,
  temporalTypeAliases,
} from '@internal/framework-components/authoring';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_BSON_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DATE_INSTANT_CODEC_ID,
  MONGO_DATE_INSTANT_STRING_CODEC_ID,
  MONGO_DATE_STRING_CODEC_ID,
  MONGO_DATE_TEMPORAL_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_DURATION_STRING_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_INT64_NUMBER_CODEC_ID,
  MONGO_JSON_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
  MONGO_TIME_STRING_CODEC_ID,
  MONGO_TIME_TEMPORAL_CODEC_ID,
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
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit date and time types. Each name says what the field stores and what the application reads. ADR 315.
 */
export const mongoDateTimeTypeConstructors = {
  DateJsDate: {
    kind: 'typeConstructor',
    documentation:
      'An instant with millisecond precision, stored as BSON date and represented as a JavaScript Date.',
    output: { codecId: MONGO_DATE_CODEC_ID },
  },
  DateInstant: {
    kind: 'typeConstructor',
    documentation:
      'An instant with millisecond precision, stored as BSON date and represented as Temporal.Instant.',
    output: { codecId: MONGO_DATE_INSTANT_CODEC_ID },
  },
  DateInstantString: {
    kind: 'typeConstructor',
    documentation:
      'An instant with millisecond precision, stored as BSON date and represented as ISO 8601 text in UTC with three fraction digits, 2024-01-01T00:00:00.000Z.',
    output: { codecId: MONGO_DATE_INSTANT_STRING_CODEC_ID },
  },
  DateString: {
    kind: 'typeConstructor',
    documentation:
      'A calendar date, stored as BSON date at midnight UTC and represented as ISO 8601 text, 2024-02-29.',
    output: { codecId: MONGO_DATE_STRING_CODEC_ID },
  },
  DateTemporal: {
    kind: 'typeConstructor',
    documentation:
      'A calendar date, stored as BSON date at midnight UTC and represented as Temporal.PlainDate.',
    output: { codecId: MONGO_DATE_TEMPORAL_CODEC_ID },
  },
  TimeString: {
    kind: 'typeConstructor',
    documentation:
      'A time of day, stored as BSON string and represented as that string, 09:30:00.000, always with three fraction digits.',
    output: { codecId: MONGO_TIME_STRING_CODEC_ID },
  },
  TimeTemporal: {
    kind: 'typeConstructor',
    documentation:
      'A time of day, stored as BSON string, 09:30:00.000, and represented as Temporal.PlainTime.',
    output: { codecId: MONGO_TIME_TEMPORAL_CODEC_ID },
  },
  DurationString: {
    kind: 'typeConstructor',
    documentation:
      'A length of time, stored as BSON string and represented as the ISO 8601 duration it was written as, such as PT1H30M.',
    output: { codecId: MONGO_DURATION_STRING_CODEC_ID },
  },
} as const satisfies AuthoringTypeNamespace;

const dateStorage = {
  kind: 'option',
  name: 'storage',
  values: ['date'],
  default: 'date',
  optional: true,
} as const;

const stringStorage = {
  kind: 'option',
  name: 'storage',
  values: ['string'],
  default: 'string',
  optional: true,
} as const;

/**
 * The convenience date and time types. Each is a type choice: its `as` argument chooses the explicit type it becomes. ADR 279, ADR 315.
 */
export const mongoConvenienceDateTimeTypes = {
  DateTime: {
    kind: 'typeChoice',
    documentation:
      'A moment in time, stored as BSON date. `as` is what the application reads: jsDate (a JavaScript Date), temporal (Temporal.Instant) or string, such as "2024-01-01T00:00:00.000Z".',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['jsDate', 'temporal', 'string'],
        default: 'jsDate',
        optional: true,
      },
      dateStorage,
    ],
    choices: [
      { when: { as: 'jsDate', storage: 'date' }, type: 'DateJsDate' },
      { when: { as: 'temporal', storage: 'date' }, type: 'DateInstant' },
      { when: { as: 'string', storage: 'date' }, type: 'DateInstantString' },
    ],
  },
  Date: {
    kind: 'typeChoice',
    documentation:
      'A calendar date, stored as BSON date at midnight UTC. `as` is what the application reads: string, such as "2024-02-29", or temporal (Temporal.PlainDate).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      dateStorage,
    ],
    choices: [
      { when: { as: 'string', storage: 'date' }, type: 'DateString' },
      { when: { as: 'temporal', storage: 'date' }, type: 'DateTemporal' },
    ],
  },
  Time: {
    kind: 'typeChoice',
    documentation:
      'A time of day, stored as BSON string. `as` is what the application reads: string, such as "09:30:00.000", or temporal (Temporal.PlainTime).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      stringStorage,
    ],
    choices: [
      { when: { as: 'string', storage: 'string' }, type: 'TimeString' },
      { when: { as: 'temporal', storage: 'string' }, type: 'TimeTemporal' },
    ],
  },
  Duration: {
    kind: 'typeChoice',
    documentation:
      'A length of time, stored as BSON string. `as` is what the application reads: string, an ISO 8601 duration such as "PT1H30M".',
    args: [
      { kind: 'option', name: 'as', values: ['string'], default: 'string', optional: true },
      stringStorage,
    ],
    choices: [{ when: { as: 'string', storage: 'string' }, type: 'DurationString' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The base scalars, the explicit date and time types and the convenience date and time types, as PSL writes them as field types and the TypeScript builder calls them as `type.X()`.
 */
export const mongoScalarTypeConstructors = {
  ...mongoScalarAuthoringTypes,
  ...mongoDateTimeTypeConstructors,
  ...mongoConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;

export const mongoAuthoringTypes = {
  ...mongoScalarTypeConstructors,
  temporal: temporalTypeAliases({ codecId: MONGO_DATE_CODEC_ID }, 'a JavaScript Date'),
} as const satisfies AuthoringTypeNamespace;
