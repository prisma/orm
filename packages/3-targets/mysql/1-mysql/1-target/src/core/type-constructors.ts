import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { SQL_VARCHAR_CODEC_ID } from '@internal/sql-relational-core/ast';
import {
  MYSQL_BIGINT_CODEC_ID,
  MYSQL_BIGINT_NUMBER_CODEC_ID,
  MYSQL_DATE_STRING_CODEC_ID,
  MYSQL_DATE_TEMPORAL_CODEC_ID,
  MYSQL_DATETIME_CODEC_ID,
  MYSQL_DATETIME_STRING_CODEC_ID,
  MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  MYSQL_DECIMAL_CODEC_ID,
  MYSQL_DOUBLE_CODEC_ID,
  MYSQL_DURATION_STRING_CODEC_ID,
  MYSQL_INT_CODEC_ID,
  MYSQL_TEXT_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';

/** The length of a `String` column: what Prisma ORM 7 used, and short enough for MySQL to index the column. */
export const MYSQL_STRING_LENGTH = 191;

/** The type of a size argument, `precision`, `scale` or `length`: an int, as for the family's `sql.Varchar(length)`. */
const MYSQL_SIZE_TYPE = 'mysql/int' as const;

const precision = {
  kind: 'value',
  dataType: MYSQL_SIZE_TYPE,
  name: 'precision',
  optional: true,
} as const;

const scale = {
  kind: 'value',
  dataType: MYSQL_SIZE_TYPE,
  name: 'scale',
  optional: true,
} as const;

const length = { kind: 'value', dataType: MYSQL_SIZE_TYPE, name: 'length' } as const;

/** The precision and scale of a bare `Decimal`: the column Prisma ORM 7 created. MySQL's own bare `decimal` is `decimal(10,0)`, which holds no digits after the point. */
const MYSQL_DECIMAL_DEFAULTS = { precision: 65, scale: 30 } as const;

/**
 * MySQL's explicit scalar types other than the date and time types. Each is named after the MySQL column type that stores it, plus the application value where that column type is read by more than one codec (`Int8BigInt` and `Int8Number`). Where that name would be a convenience name, the explicit type takes MySQL's own second name for the column type, as PostgreSQL's explicit types do: `Int4`, `Int8…`, `Float8` and `NumericString`. ADR 322.
 */
export const mysqlExplicitScalarTypes = {
  Int4: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 32-bit integer stored as MySQL int and represented as a JavaScript number.',
    output: { codecId: MYSQL_INT_CODEC_ID },
  },
  Int8BigInt: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 64-bit integer stored as MySQL bigint and represented as a JavaScript bigint.',
    output: { codecId: MYSQL_BIGINT_CODEC_ID },
  },
  Int8Number: {
    kind: 'typeConstructor',
    documentation:
      'A signed 64-bit integer stored as MySQL bigint and represented as a JavaScript number within its safe integer range.',
    output: { codecId: MYSQL_BIGINT_NUMBER_CODEC_ID },
  },
  Float8: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A double-precision floating-point number stored as MySQL double and represented as a JavaScript number.',
    output: { codecId: MYSQL_DOUBLE_CODEC_ID },
  },
  NumericString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'An exact decimal number stored as MySQL decimal and represented as decimal text, with every digit the column holds after the point: 1.5 in a decimal(10,2) reads "1.50". `precision` is the digits the column holds, at most 65, and `scale` the digits after the point, at most 30; MySQL holds decimal(10,0) when neither is written.',
    args: [precision, scale],
    output: {
      codecId: MYSQL_DECIMAL_CODEC_ID,
      typeParams: { precision: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } },
    },
  },
  Varchar: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'Text of at most `length` characters, stored as MySQL varchar. A column of at most 191 characters can be indexed.',
    args: [length],
    output: { codecId: SQL_VARCHAR_CODEC_ID, typeParams: { length: { kind: 'arg', index: 0 } } },
  },
  Text: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'Text of up to 65,535 bytes, stored as MySQL text. MySQL cannot index a text column without a prefix length.',
    output: { codecId: MYSQL_TEXT_CODEC_ID },
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
 * The convenience types of MySQL's scalars. Each is a type choice: `storage` names the MySQL column type that stores the value and, for `BigInt`, `as` chooses the application value; `precision`, `scale` and `length` are passed on to the explicit type chosen. A bare name gives the column it gave before these were type choices, which is the column Prisma ORM 7 created. ADR 279, ADR 322.
 */
export const mysqlConvenienceScalarTypes = {
  Int: {
    kind: 'typeChoice',
    documentation:
      'An integer read as a JavaScript number, stored as MySQL int, a signed 32-bit integer.',
    args: [storageOption('int')],
    choices: [{ when: { storage: 'int' }, type: 'Int4' }],
  },
  BigInt: {
    kind: 'typeChoice',
    documentation:
      'A signed 64-bit integer, stored as MySQL bigint. `as` is what the application reads: bigint, or number within the safe integer range.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['bigint', 'number'],
        default: 'bigint',
        optional: true,
      },
      storageOption('bigint'),
    ],
    choices: [
      { when: { as: 'bigint', storage: 'bigint' }, type: 'Int8BigInt' },
      { when: { as: 'number', storage: 'bigint' }, type: 'Int8Number' },
    ],
  },
  Float: {
    kind: 'typeChoice',
    documentation:
      'A floating-point number, stored as MySQL double, a double-precision float, which holds every JavaScript number but NaN and the infinities.',
    args: [storageOption('double')],
    choices: [{ when: { storage: 'double' }, type: 'Float8' }],
  },
  Decimal: {
    kind: 'typeChoice',
    documentation: `An exact decimal number, read as decimal text with every digit the column holds after the point, such as "12.50" in a decimal(10,2). \`storage\` is decimal, of \`precision\` digits, \`scale\` of them after the point: decimal(${MYSQL_DECIMAL_DEFAULTS.precision},${MYSQL_DECIMAL_DEFAULTS.scale}) unless written.`,
    args: [storageOption('decimal'), precision, scale],
    choices: [
      { when: { storage: 'decimal' }, type: 'NumericString', defaults: MYSQL_DECIMAL_DEFAULTS },
    ],
  },
  String: {
    kind: 'typeChoice',
    documentation: `Text. \`storage\` is varchar, of at most \`length\` characters, ${MYSQL_STRING_LENGTH} unless written, so that it can be indexed; or text, of up to 65,535 bytes, which cannot be indexed without a prefix length.`,
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['varchar', 'text'],
        default: 'varchar',
        optional: true,
      },
      { ...length, optional: true },
    ],
    choices: [
      { when: { storage: 'varchar' }, type: 'Varchar', defaults: { length: MYSQL_STRING_LENGTH } },
      { when: { storage: 'text' }, type: 'Text' },
    ],
  },
} as const satisfies AuthoringTypeNamespace;

/** The explicit type `codecId`, whose `precision` argument is the number of fraction digits its column holds, 0 to 6; MySQL holds 0 when none is written. */
function withPrecision<const CodecId extends string>(codecId: CodecId, documentation: string) {
  return {
    kind: 'typeConstructor',
    documentation,
    args: [precision],
    output: { codecId, typeParams: { precision: { kind: 'arg', index: 0 } } },
  } as const;
}

/**
 * The explicit date and time types. Each is named after its MySQL column type, with a suffix for the value the application reads; `DurationString` is stored as `varchar`, since MySQL has no interval type. ADR 315.
 */
export const mysqlDateTimeTypeConstructors = {
  DatetimeJsDate: {
    ...withPrecision(
      MYSQL_DATETIME_CODEC_ID,
      'An instant stored as MySQL datetime in UTC and represented as a JavaScript Date. `precision` is the fraction digits the column holds, 0 to 6.',
    ),
    inferred: true,
  },
  DatetimeTemporal: withPrecision(
    MYSQL_DATETIME_TEMPORAL_CODEC_ID,
    'An instant stored as MySQL datetime in UTC and represented as Temporal.Instant. `precision` is the fraction digits the column holds, 0 to 6.',
  ),
  DatetimeString: withPrecision(
    MYSQL_DATETIME_STRING_CODEC_ID,
    'An instant stored as MySQL datetime in UTC and represented as ISO 8601 text in UTC, such as 2024-01-01T00:00:00.5Z. `precision` is the fraction digits the column holds, 0 to 6.',
  ),
  TimestampJsDate: {
    ...withPrecision(
      MYSQL_TIMESTAMP_DATE_CODEC_ID,
      'An instant from 1970 to 2038 stored as MySQL timestamp and represented as a JavaScript Date. `precision` is the fraction digits the column holds, 0 to 6.',
    ),
    inferred: true,
  },
  TimestampTemporal: withPrecision(
    MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
    'An instant from 1970 to 2038 stored as MySQL timestamp and represented as Temporal.Instant. `precision` is the fraction digits the column holds, 0 to 6.',
  ),
  TimestampString: withPrecision(
    MYSQL_TIMESTAMP_STRING_CODEC_ID,
    'An instant from 1970 to 2038 stored as MySQL timestamp and represented as ISO 8601 text in UTC, such as 2024-01-01T00:00:00.5Z. `precision` is the fraction digits the column holds, 0 to 6.',
  ),
  DateString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A calendar date stored as MySQL date and represented as ISO 8601 text, such as 2024-02-29.',
    output: { codecId: MYSQL_DATE_STRING_CODEC_ID },
  },
  DateTemporal: {
    kind: 'typeConstructor',
    documentation: 'A calendar date stored as MySQL date and represented as Temporal.PlainDate.',
    output: { codecId: MYSQL_DATE_TEMPORAL_CODEC_ID },
  },
  TimeString: {
    ...withPrecision(
      MYSQL_TIME_STRING_CODEC_ID,
      'A time of day stored as MySQL time and represented as ISO 8601 text, such as 09:30:00. `precision` is the fraction digits the column holds, 0 to 6.',
    ),
    inferred: true,
  },
  TimeTemporal: withPrecision(
    MYSQL_TIME_TEMPORAL_CODEC_ID,
    'A time of day stored as MySQL time and represented as Temporal.PlainTime. `precision` is the fraction digits the column holds, 0 to 6.',
  ),
  DurationString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: `A length of time stored as MySQL varchar(${MYSQL_STRING_LENGTH}), so that it can be indexed, and represented as the ISO 8601 duration it was written as, such as PT1H30M.`,
    output: {
      codecId: MYSQL_DURATION_STRING_CODEC_ID,
      typeParams: { length: MYSQL_STRING_LENGTH },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const MICROSECONDS = { precision: 6 } as const;
const MILLISECONDS = { precision: 3 } as const;

/**
 * The convenience date and time types. Each is a type choice: its `as` and `storage` arguments choose the explicit type it becomes, and `precision` is passed on to that type. MySQL holds no fraction of a second in a bare `datetime`, `timestamp` or `time`, so a row that reads a `Date` defaults to milliseconds, which a `Date` holds, and every other row to microseconds, as PostgreSQL's bare types hold. ADR 279, ADR 315.
 */
export const mysqlConvenienceDateTimeTypes = {
  DateTime: {
    kind: 'typeChoice',
    documentation:
      'A moment in time, read and written in UTC. `as` is what the application reads: jsDate (a JavaScript Date), temporal (Temporal.Instant) or string, such as "2024-01-01T00:00:00Z". `storage` is datetime, or timestamp, which holds 1970 to 2038.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['jsDate', 'temporal', 'string'],
        default: 'jsDate',
        optional: true,
      },
      {
        kind: 'option',
        name: 'storage',
        values: ['datetime', 'timestamp'],
        default: 'datetime',
        optional: true,
      },
      precision,
    ],
    choices: [
      {
        when: { as: 'jsDate', storage: 'datetime' },
        type: 'DatetimeJsDate',
        defaults: MILLISECONDS,
      },
      {
        when: { as: 'temporal', storage: 'datetime' },
        type: 'DatetimeTemporal',
        defaults: MICROSECONDS,
      },
      {
        when: { as: 'string', storage: 'datetime' },
        type: 'DatetimeString',
        defaults: MICROSECONDS,
      },
      {
        when: { as: 'jsDate', storage: 'timestamp' },
        type: 'TimestampJsDate',
        defaults: MILLISECONDS,
      },
      {
        when: { as: 'temporal', storage: 'timestamp' },
        type: 'TimestampTemporal',
        defaults: MICROSECONDS,
      },
      {
        when: { as: 'string', storage: 'timestamp' },
        type: 'TimestampString',
        defaults: MICROSECONDS,
      },
    ],
  },
  Date: {
    kind: 'typeChoice',
    documentation:
      'A calendar date. `as` is what the application reads: string, such as "2024-02-29", or temporal (Temporal.PlainDate).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      { kind: 'option', name: 'storage', values: ['date'], default: 'date', optional: true },
    ],
    choices: [
      { when: { as: 'string', storage: 'date' }, type: 'DateString' },
      { when: { as: 'temporal', storage: 'date' }, type: 'DateTemporal' },
    ],
  },
  Time: {
    kind: 'typeChoice',
    documentation:
      'A time of day, from 00:00:00 to 23:59:59.999999. `as` is what the application reads: string, such as "09:30:00", or temporal (Temporal.PlainTime).',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      { kind: 'option', name: 'storage', values: ['time'], default: 'time', optional: true },
      precision,
    ],
    choices: [
      { when: { as: 'string', storage: 'time' }, type: 'TimeString', defaults: MICROSECONDS },
      { when: { as: 'temporal', storage: 'time' }, type: 'TimeTemporal', defaults: MICROSECONDS },
    ],
  },
  Duration: {
    kind: 'typeChoice',
    documentation: `A length of time, stored as MySQL varchar(${MYSQL_STRING_LENGTH}), since MySQL has no interval type. \`as\` is what the application reads: string, an ISO 8601 duration such as "PT1H30M".`,
    args: [
      { kind: 'option', name: 'as', values: ['string'], default: 'string', optional: true },
      { kind: 'option', name: 'storage', values: ['varchar'], default: 'varchar', optional: true },
    ],
    choices: [{ when: { as: 'string', storage: 'varchar' }, type: 'DurationString' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The explicit and convenience scalar types, the explicit date and time types and the convenience date and time types. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const mysqlScalarTypeConstructors = {
  ...mysqlExplicitScalarTypes,
  ...mysqlConvenienceScalarTypes,
  ...mysqlDateTimeTypeConstructors,
  ...mysqlConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;
