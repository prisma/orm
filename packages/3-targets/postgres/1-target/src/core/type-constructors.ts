import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  PG_INTERVAL_STRING_CODEC_ID,
  PG_TIMESTAMP_DATE_CODEC_ID,
  PG_TIMESTAMP_INSTANT_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
} from './codec-ids';

/** The data type of every size argument on Postgres, such as a length or a precision: a typmod is an `int4`. */
export const PG_SIZE_TYPE = 'pg/int4' as const;

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel. Each names a codec; the column's database type is its data type's.
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@onCreate(uuid())`) never re-picks a column's storage.
 */
export const postgresScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Variable-length text stored as PostgreSQL text.',
    output: { codecId: 'pg/text@1' },
  },
  Boolean: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A true or false value stored as PostgreSQL boolean.',
    output: { codecId: 'pg/bool@1' },
  },
  Int: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A signed 32-bit integer represented as a JavaScript number.',
    output: { codecId: 'pg/int4@1' },
  },
  BigInt: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A signed 64-bit integer represented as a JavaScript bigint.',
    output: { codecId: 'pg/int8@1' },
  },
  Float: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A double-precision floating-point number.',
    output: { codecId: 'pg/float8@1' },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'An exact decimal value stored as PostgreSQL numeric.',
    output: { codecId: 'pg/numeric@1' },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as PostgreSQL timestamptz and represented as Temporal.Instant.',
    output: { codecId: 'pg/timestamptz-temporal@1' },
  },
  Json: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A JSON value stored as PostgreSQL json.',
    output: { codecId: 'pg/json@1' },
  },
  Jsonb: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A JSON value stored in PostgreSQL binary jsonb format.',
    output: { codecId: 'pg/jsonb@1' },
  },
  Bytes: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Binary data stored as PostgreSQL bytea.',
    output: { codecId: 'pg/bytea@1' },
  },
} as const satisfies AuthoringTypeNamespace;

export const postgresNativeAuthoringTypes = {
  VarChar: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Variable-length text with an optional maximum character length.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'length', optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Char: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Fixed-length, blank-padded text with an optional character length.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'length', optional: true }],
    output: {
      codecId: 'sql/char@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'An exact decimal value with optional precision and scale.',
    args: [
      { kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true },
      { kind: 'value', dataType: PG_SIZE_TYPE, name: 'scale', optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  TimestampTemporal: {
    kind: 'typeConstructor',
    documentation: 'A date and time without a time zone, represented as Temporal.PlainDateTime.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzTemporal: {
    kind: 'typeConstructor',
    documentation:
      'An instant represented as Temporal.Instant, with optional fractional-second precision.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimeTemporal: {
    kind: 'typeConstructor',
    documentation: 'A time of day without a time zone, represented as Temporal.PlainTime.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/time-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Time: {
    kind: 'typeConstructor',
    documentation: 'A time of day without a time zone, represented as Temporal.PlainTime.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/time-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timetz: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A time of day with a UTC offset stored as PostgreSQL timetz and represented as ISO 8601 text.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timetz@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Uuid: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A universally unique identifier stored as PostgreSQL uuid.',
    output: { codecId: 'pg/uuid@1' },
  },
  Inet: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'An IPv4 or IPv6 address with an optional subnet mask.',
    output: { codecId: 'pg/inet@1' },
  },
  SmallInt: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A signed 16-bit integer represented as a JavaScript number.',
    output: { codecId: 'pg/int2@1' },
  },
  Real: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A single-precision floating-point number.',
    output: { codecId: 'pg/float4@1' },
  },
  DateTemporal: {
    kind: 'typeConstructor',
    documentation: 'A calendar date represented as Temporal.PlainDate.',
    output: { codecId: 'pg/date-temporal@1' },
  },
  Date: {
    kind: 'typeConstructor',
    documentation: 'A calendar date represented as Temporal.PlainDate.',
    output: { codecId: 'pg/date-temporal@1' },
  },
  // The representation-explicit spellings. Same columns, same precision, same native types — the
  // only difference is that a read hands back ISO 8601 text instead of a `Temporal.*`, so a value
  // Temporal cannot express still round-trips.
  DateString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A PostgreSQL date represented as ISO 8601 text rather than Temporal.PlainDate.',
    output: { codecId: 'pg/date-string@1' },
  },
  TimestampString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A timestamp without a time zone represented as ISO 8601 text.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzJsDate: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as PostgreSQL timestamptz and represented as a JavaScript Date.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestampJsDate: {
    kind: 'typeConstructor',
    documentation:
      'A date and time stored as PostgreSQL timestamp and represented as a JavaScript Date, read and written as UTC.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: PG_TIMESTAMP_DATE_CODEC_ID,
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestampInstant: {
    kind: 'typeConstructor',
    documentation:
      'A date and time stored as PostgreSQL timestamp and represented as Temporal.Instant, read and written as UTC.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: PG_TIMESTAMP_INSTANT_CODEC_ID,
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A timestamp with time zone represented as ISO 8601 text, the instant in UTC.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamptz-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimeString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A time of day without a time zone represented as ISO 8601 text.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/time-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Bit: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A fixed-length bit string with an optional length in bits.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'length', optional: true }],
    output: {
      codecId: 'pg/bit@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  VarBit: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A variable-length bit string with an optional maximum length in bits.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'length', optional: true }],
    output: {
      codecId: 'pg/varbit@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  IntervalParts: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A span of time stored as PostgreSQL interval and represented as { months, days, micros }, with optional fractional-second precision.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/interval@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  IntervalString: {
    kind: 'typeConstructor',
    documentation:
      'A span of time stored as PostgreSQL interval and represented as an ISO 8601 duration such as P1Y2M, with optional fractional-second precision.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: PG_INTERVAL_STRING_CODEC_ID,
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The base scalars and native types as type constructors. The target contributes them, so PSL and the TypeScript builder's `type.*` see the same names.
 */
export const postgresScalarAndNativeTypeConstructors = {
  ...postgresNativeAuthoringTypes,
  ...postgresScalarAuthoringTypes,
} as const satisfies AuthoringTypeNamespace;
