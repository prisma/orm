import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATE_STRING_CODEC_ID,
  SQLITE_DATE_TEMPORAL_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_DATETIME_STRING_CODEC_ID,
  SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  SQLITE_DURATION_STRING_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
  SQLITE_TIME_STRING_CODEC_ID,
  SQLITE_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel. Each names a codec; the column's database type is its data type's.
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@onCreate(uuid())`) never re-picks a column's storage.
 *
 * The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const sqliteScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Variable-length text stored as SQLite text.',
    output: { codecId: SQLITE_TEXT_CODEC_ID },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript number.',
    output: { codecId: SQLITE_INTEGER_CODEC_ID },
  },
  BigInt: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript bigint.',
    output: { codecId: SQLITE_BIGINT_CODEC_ID },
  },
  Float: {
    kind: 'typeConstructor',
    documentation: 'A floating-point number stored as SQLite real.',
    output: { codecId: SQLITE_REAL_CODEC_ID },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'A decimal value stored and represented as text to preserve precision.',
    output: { codecId: SQLITE_TEXT_CODEC_ID },
  },
  Json: {
    kind: 'typeConstructor',
    documentation: 'A JSON value serialized to SQLite text.',
    output: { codecId: SQLITE_JSON_CODEC_ID },
  },
  Bytes: {
    kind: 'typeConstructor',
    documentation: 'Binary data stored as a SQLite blob.',
    output: { codecId: SQLITE_BLOB_CODEC_ID },
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit date and time types. SQLite has no date or time column type, so each is stored as text, in one form for each value, and its name says what the text holds and what the application reads. ADR 312.
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

const textStorage = {
  kind: 'option',
  name: 'storage',
  values: ['text'],
  default: 'text',
  optional: true,
} as const;

/**
 * The convenience date and time types. Each is a type choice: its `as` argument chooses the explicit type it becomes. Every SQLite date and time type is stored as text, so `storage` is text only. ADR 279, ADR 312.
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
 * The base scalars, the explicit date and time types and the convenience date and time types as type constructors. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const sqliteScalarTypeConstructors = {
  ...sqliteScalarAuthoringTypes,
  ...sqliteDateTimeTypeConstructors,
  ...sqliteConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;
