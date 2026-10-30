import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { SQL_VARCHAR_CODEC_ID } from '@internal/sql-relational-core/ast';
import {
  MYSQL_BIGINT_CODEC_ID,
  MYSQL_DATE_STRING_CODEC_ID,
  MYSQL_DATE_TEMPORAL_CODEC_ID,
  MYSQL_DATETIME_CODEC_ID,
  MYSQL_DATETIME_STRING_CODEC_ID,
  MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  MYSQL_DURATION_STRING_CODEC_ID,
  MYSQL_INT_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';

/** The length of a `String` column: what Prisma ORM 7 used, and short enough for MySQL to index the column. */
export const MYSQL_STRING_LENGTH = 191;

/**
 * The base PSL scalars other than the date and time types, as zero-arg type constructors. Each names a codec; the column's database type is its data type's. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const mysqlScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: `Text of at most ${MYSQL_STRING_LENGTH} characters, stored as MySQL varchar(${MYSQL_STRING_LENGTH}) so that it can be indexed.`,
    output: { codecId: SQL_VARCHAR_CODEC_ID, typeParams: { length: MYSQL_STRING_LENGTH } },
  },
  Int: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 32-bit integer stored as MySQL int and represented as a JavaScript number.',
    output: { codecId: MYSQL_INT_CODEC_ID },
  },
  BigInt: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 64-bit integer stored as MySQL bigint and represented as a JavaScript bigint.',
    output: { codecId: MYSQL_BIGINT_CODEC_ID },
  },
} as const satisfies AuthoringTypeNamespace;

/** The size type of a `precision` argument: an int, as for the family's `sql.String(length)`. */
const MYSQL_SIZE_TYPE = 'mysql/int' as const;

const precision = {
  kind: 'value',
  dataType: MYSQL_SIZE_TYPE,
  name: 'precision',
  optional: true,
} as const;

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
 * The base scalars, the explicit date and time types and the convenience date and time types as type constructors. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const mysqlScalarTypeConstructors = {
  ...mysqlScalarAuthoringTypes,
  ...mysqlDateTimeTypeConstructors,
  ...mysqlConvenienceDateTimeTypes,
} as const satisfies AuthoringTypeNamespace;
