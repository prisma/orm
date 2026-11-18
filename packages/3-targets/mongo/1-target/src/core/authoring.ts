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

const int64BigInt = {
  kind: 'typeConstructor',
  documentation: 'A signed 64-bit integer read as a bigint, stored as BSON long.',
  output: { codecId: MONGO_INT64_CODEC_ID },
} as const;

/**
 * The explicit MongoDB scalar types, each named after the BSON type that stores it, which PSL writes as field types and the TypeScript builder calls as `type.X()`. Each names a codec; the collection validator reads the BSON types from the data type the codec represents, not from the constructor.
 */
const mongoExplicitScalarTypes = {
  BsonString: {
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
  Int64BigInt: int64BigInt,
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
  PlainJson: {
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
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit types' former names, kept for one release line as deprecated aliases. Each gives the same codec as its replacement, and the PSL interpreter warns where one is written. A deprecated name has no `type.*` helper. ADR 257.
 */
const mongoDeprecatedScalarTypes = {
  Int64: {
    ...int64BigInt,
    documentation: `Deprecated: use Int64BigInt. ${int64BigInt.documentation}`,
    deprecated: { replacement: 'Int64BigInt' },
  },
} as const satisfies AuthoringTypeNamespace;

function storageOption<const Storage extends string>(storage: Storage) {
  return {
    kind: 'option',
    name: 'storage',
    values: [storage],
    default: storage,
    optional: true,
  } as const;
}

/**
 * The convenience types of MongoDB's scalars. Each is a type choice: `storage` names the BSON type that stores the value and, for `BigInt`, `as` chooses the application value. ADR 279.
 */
const mongoConvenienceScalarTypes = {
  Int: {
    kind: 'typeChoice',
    documentation: 'An integer read as a JavaScript number, stored as BSON int, a 32-bit integer.',
    args: [storageOption('int')],
    choices: [{ when: { storage: 'int' }, type: 'Int32' }],
  },
  BigInt: {
    kind: 'typeChoice',
    documentation:
      'An integer that may exceed 32 bits, stored as BSON long, a 64-bit integer. `as` is what the application reads: bigint, or number within the safe integer range.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['bigint', 'number'],
        default: 'bigint',
        optional: true,
      },
      storageOption('long'),
    ],
    choices: [
      { when: { as: 'bigint', storage: 'long' }, type: 'Int64BigInt' },
      { when: { as: 'number', storage: 'long' }, type: 'Int64Number' },
    ],
  },
  Float: {
    kind: 'typeChoice',
    documentation: 'A floating-point number, stored as BSON double.',
    args: [storageOption('double')],
    choices: [{ when: { storage: 'double' }, type: 'Double' }],
  },
  Decimal: {
    kind: 'typeChoice',
    documentation:
      'An exact decimal number, read as decimal text such as "12.50", stored as BSON decimal.',
    args: [storageOption('decimal')],
    choices: [{ when: { storage: 'decimal' }, type: 'Decimal128' }],
  },
  Boolean: {
    kind: 'typeChoice',
    documentation: 'A true or false value, stored as BSON bool.',
    args: [storageOption('bool')],
    choices: [{ when: { storage: 'bool' }, type: 'Bool' }],
  },
  Bytes: {
    kind: 'typeChoice',
    documentation: 'Binary data, read as a Uint8Array, stored as BSON binData.',
    args: [storageOption('binData')],
    choices: [{ when: { storage: 'binData' }, type: 'Binary' }],
  },
  String: {
    kind: 'typeChoice',
    documentation: 'Text, stored as BSON string.',
    args: [storageOption('string')],
    choices: [{ when: { storage: 'string' }, type: 'BsonString' }],
  },
  Json: {
    kind: 'typeChoice',
    documentation:
      'A JSON value. `storage` is bson: the value is stored as whichever BSON value fits it, an object, array, string, number, bool or null. It is not the Bson type, which takes any BSON value.',
    args: [storageOption('bson')],
    choices: [{ when: { storage: 'bson' }, type: 'PlainJson' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * MongoDB's scalar types other than the date and time types: the explicit types, the convenience types and the deprecated aliases. `mongoScalarTypeConstructors` adds the date and time types.
 */
export const mongoScalarAuthoringTypes = {
  ...mongoExplicitScalarTypes,
  ...mongoConvenienceScalarTypes,
  ...mongoDeprecatedScalarTypes,
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit date and time types. Each name says what the field stores and what the application reads. ADR 315.
 */
export const mongoExplicitDateTimeTypes = {
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
      storageOption('date'),
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
      storageOption('date'),
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
      storageOption('string'),
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
      storageOption('string'),
    ],
    choices: [{ when: { as: 'string', storage: 'string' }, type: 'DurationString' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * All of MongoDB's scalar types, including the date and time types, explicit and convenience, as PSL writes them as field types and the TypeScript builder calls them as `type.X()`.
 */
export const mongoScalarTypeConstructors = {
  ...mongoScalarAuthoringTypes,
  ...mongoExplicitDateTimeTypes,
  ...mongoConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;

export const mongoAuthoringTypes = {
  ...mongoScalarTypeConstructors,
  temporal: temporalTypeAliases({ codecId: MONGO_DATE_CODEC_ID }, 'a JavaScript Date'),
} as const satisfies AuthoringTypeNamespace;
