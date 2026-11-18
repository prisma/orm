import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_BOOLEAN_CODEC_ID,
  SQLITE_DATE_STRING_CODEC_ID,
  SQLITE_DATE_TEMPORAL_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_DATETIME_STRING_CODEC_ID,
  SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  SQLITE_DECIMAL_CODEC_ID,
  SQLITE_DURATION_STRING_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
  SQLITE_TIME_STRING_CODEC_ID,
  SQLITE_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';

const integerNumber = {
  kind: 'typeConstructor',
  documentation:
    'An integer read as a JavaScript number within its safe integer range, stored as SQLite integer.',
  output: { codecId: SQLITE_INTEGER_CODEC_ID },
} as const;

/**
 * The explicit SQLite scalar types. An explicit type is named after the SQLite column type that stores it: `Text`, `Real` and `Blob`. `integer` is read as three kinds of value, so its types carry the value too: `IntegerNumber`, `IntegerBigInt` and `IntegerBoolean`. A type stored as `text` that holds a value with a form of its own is named after that value instead: `DecimalString`, `PlainJson` and the date and time types. PSL writes them as field types and the TypeScript builder calls them as `type.X()`. ADR 315, ADR 322.
 */
export const sqliteExplicitScalarTypes = {
  IntegerNumber: integerNumber,
  IntegerBigInt: {
    kind: 'typeConstructor',
    documentation: 'An integer read as a JavaScript bigint, stored as SQLite integer.',
    output: { codecId: SQLITE_BIGINT_CODEC_ID },
  },
  Real: {
    kind: 'typeConstructor',
    documentation: 'A floating-point number, stored as SQLite real.',
    output: { codecId: SQLITE_REAL_CODEC_ID },
  },
  DecimalString: {
    kind: 'typeConstructor',
    documentation:
      'An exact decimal number read as decimal text such as "12.50", stored as SQLite text. Text compares by its characters, so a field of this type can be compared for equality but not ordered or summed.',
    output: { codecId: SQLITE_DECIMAL_CODEC_ID },
  },
  Text: {
    kind: 'typeConstructor',
    documentation: 'Text, stored as SQLite text.',
    output: { codecId: SQLITE_TEXT_CODEC_ID },
  },
  IntegerBoolean: {
    kind: 'typeConstructor',
    documentation:
      'A boolean, stored as SQLite integer: 0 for false and 1 for true, as SQLite writes FALSE and TRUE.',
    output: { codecId: SQLITE_BOOLEAN_CODEC_ID },
  },
  Blob: {
    kind: 'typeConstructor',
    documentation: 'Binary data read as a Uint8Array, stored as SQLite blob.',
    output: { codecId: SQLITE_BLOB_CODEC_ID },
  },
  PlainJson: {
    kind: 'typeConstructor',
    documentation: 'A JSON value, serialized and stored as SQLite text.',
    output: { codecId: SQLITE_JSON_CODEC_ID },
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
 * The convenience types of SQLite's scalars. Each is a type choice: `storage` names the SQLite column type that stores the value and, for `BigInt`, `as` chooses the application value. `Int` comes before `BigInt`, so `IntegerNumber`, which both can choose, is written `Int`. ADR 279, ADR 322.
 */
export const sqliteConvenienceScalarTypes = {
  Int: {
    kind: 'typeChoice',
    documentation:
      'An integer read as a JavaScript number within its safe integer range, stored as SQLite integer.',
    args: [storageOption('integer')],
    choices: [{ when: { storage: 'integer' }, type: 'IntegerNumber' }],
  },
  BigInt: {
    kind: 'typeChoice',
    documentation:
      'An integer that may exceed the safe integer range, stored as SQLite integer. `as` is what the application reads: bigint, or number within the safe integer range.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['bigint', 'number'],
        default: 'bigint',
        optional: true,
      },
      storageOption('integer'),
    ],
    choices: [
      { when: { as: 'bigint', storage: 'integer' }, type: 'IntegerBigInt' },
      { when: { as: 'number', storage: 'integer' }, type: 'IntegerNumber' },
    ],
  },
  Float: {
    kind: 'typeChoice',
    documentation: 'A floating-point number, stored as SQLite real.',
    args: [storageOption('real')],
    choices: [{ when: { storage: 'real' }, type: 'Real' }],
  },
  Decimal: {
    kind: 'typeChoice',
    documentation:
      'An exact decimal number read as decimal text such as "12.50", stored as SQLite text. It can be compared for equality but not ordered or summed.',
    args: [storageOption('text')],
    choices: [{ when: { storage: 'text' }, type: 'DecimalString' }],
  },
  String: {
    kind: 'typeChoice',
    documentation: 'Text, stored as SQLite text.',
    args: [storageOption('text')],
    choices: [{ when: { storage: 'text' }, type: 'Text' }],
  },
  Boolean: {
    kind: 'typeChoice',
    documentation:
      'A boolean, stored as SQLite integer: 0 for false and 1 for true, as SQLite writes FALSE and TRUE.',
    args: [storageOption('integer')],
    choices: [{ when: { storage: 'integer' }, type: 'IntegerBoolean' }],
  },
  Bytes: {
    kind: 'typeChoice',
    documentation: 'Binary data read as a Uint8Array, stored as SQLite blob.',
    args: [storageOption('blob')],
    choices: [{ when: { storage: 'blob' }, type: 'Blob' }],
  },
  Json: {
    kind: 'typeChoice',
    documentation: 'A JSON value, serialized and stored as SQLite text.',
    args: [storageOption('text')],
    choices: [{ when: { storage: 'text' }, type: 'PlainJson' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit types' former names, kept for one release line as deprecated aliases. Each gives the same codec as its replacement, and the PSL interpreter warns where one is written (ADR 257).
 */
export const sqliteDeprecatedScalarTypes = {
  BigIntNumber: { ...integerNumber, deprecated: { replacement: 'IntegerNumber' } },
} as const satisfies AuthoringTypeNamespace;

/**
 * SQLite's scalar types other than the date and time types: the explicit types, the convenience types and the deprecated aliases. `sqliteScalarTypeConstructors` adds the date and time types.
 */
export const sqliteScalarAuthoringTypes = {
  ...sqliteExplicitScalarTypes,
  ...sqliteConvenienceScalarTypes,
  ...sqliteDeprecatedScalarTypes,
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit date and time types. SQLite has no date or time column type, so each is stored as text, in one form for each value, and its name says what the text holds and what the application reads. ADR 315.
 */
export const sqliteDateTimeTypeConstructors = {
  DatetimeJsDate: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as SQLite text, 2024-01-01T00:00:00.000Z, and represented as a JavaScript Date.',
    output: { codecId: SQLITE_DATETIME_CODEC_ID },
  },
  DatetimeTemporal: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as SQLite text, 2024-01-01T00:00:00.000Z, and represented as Temporal.Instant.',
    output: { codecId: SQLITE_DATETIME_TEMPORAL_CODEC_ID },
  },
  DatetimeString: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as SQLite text and represented as that text, 2024-01-01T00:00:00.000Z, the instant in UTC.',
    output: { codecId: SQLITE_DATETIME_STRING_CODEC_ID },
  },
  DateString: {
    kind: 'typeConstructor',
    documentation:
      'A calendar date stored as SQLite text and represented as that text, 2024-02-29.',
    output: { codecId: SQLITE_DATE_STRING_CODEC_ID },
  },
  DateTemporal: {
    kind: 'typeConstructor',
    documentation:
      'A calendar date stored as SQLite text, 2024-02-29, and represented as Temporal.PlainDate.',
    output: { codecId: SQLITE_DATE_TEMPORAL_CODEC_ID },
  },
  TimeString: {
    kind: 'typeConstructor',
    documentation:
      'A time of day stored as SQLite text and represented as that text, 09:30:00.000, always with three fraction digits.',
    output: { codecId: SQLITE_TIME_STRING_CODEC_ID },
  },
  TimeTemporal: {
    kind: 'typeConstructor',
    documentation:
      'A time of day stored as SQLite text, 09:30:00.000, and represented as Temporal.PlainTime.',
    output: { codecId: SQLITE_TIME_TEMPORAL_CODEC_ID },
  },
  DurationString: {
    kind: 'typeConstructor',
    documentation:
      'A length of time stored as SQLite text and represented as the ISO 8601 duration it was written as, such as PT1H30M.',
    output: { codecId: SQLITE_DURATION_STRING_CODEC_ID },
  },
} as const satisfies AuthoringTypeNamespace;

const textStorage = storageOption('text');

/**
 * The convenience date and time types. Each is a type choice: its `as` argument chooses the explicit type it becomes. Every SQLite date and time type is stored as text, so `storage` is text only. ADR 279, ADR 315.
 */
export const sqliteConvenienceDateTimeTypes = {
  DateTime: {
    kind: 'typeChoice',
    documentation:
      'A moment in time, stored as SQLite text. `as` is what the application reads: jsDate (a JavaScript Date), temporal (Temporal.Instant) or string, such as "2024-01-01T00:00:00.000Z".',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['jsDate', 'temporal', 'string'],
        default: 'jsDate',
        optional: true,
      },
      textStorage,
    ],
    choices: [
      { when: { as: 'jsDate', storage: 'text' }, type: 'DatetimeJsDate' },
      { when: { as: 'temporal', storage: 'text' }, type: 'DatetimeTemporal' },
      { when: { as: 'string', storage: 'text' }, type: 'DatetimeString' },
    ],
  },
  Date: {
    kind: 'typeChoice',
    documentation:
      'A calendar date, stored as SQLite text. `as` is what the application reads: string, such as "2024-02-29", or temporal (Temporal.PlainDate).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      textStorage,
    ],
    choices: [
      { when: { as: 'string', storage: 'text' }, type: 'DateString' },
      { when: { as: 'temporal', storage: 'text' }, type: 'DateTemporal' },
    ],
  },
  Time: {
    kind: 'typeChoice',
    documentation:
      'A time of day, stored as SQLite text. `as` is what the application reads: string, such as "09:30:00.000", or temporal (Temporal.PlainTime).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      textStorage,
    ],
    choices: [
      { when: { as: 'string', storage: 'text' }, type: 'TimeString' },
      { when: { as: 'temporal', storage: 'text' }, type: 'TimeTemporal' },
    ],
  },
  Duration: {
    kind: 'typeChoice',
    documentation:
      'A length of time, stored as SQLite text. `as` is what the application reads: string, an ISO 8601 duration such as "PT1H30M".',
    args: [
      { kind: 'option', name: 'as', values: ['string'], default: 'string', optional: true },
      textStorage,
    ],
    choices: [{ when: { as: 'string', storage: 'text' }, type: 'DurationString' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The scalar types, the explicit date and time types and the convenience date and time types. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const sqliteScalarTypeConstructors = {
  ...sqliteScalarAuthoringTypes,
  ...sqliteDateTimeTypeConstructors,
  ...sqliteConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;
