import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  PG_INTERVAL_STRING_CODEC_ID,
  PG_TIMESTAMP_DATE_CODEC_ID,
  PG_TIMESTAMP_INSTANT_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
} from './codec-ids';

/** The data type of every size argument on Postgres, such as a length or a precision: a typmod is an `int4`. */
export const PG_SIZE_TYPE = 'pg/int4' as const;

const length = {
  kind: 'value',
  dataType: PG_SIZE_TYPE,
  name: 'length',
  optional: true,
} as const;

const int2 = {
  kind: 'typeConstructor',
  documentation:
    'A signed 16-bit integer stored as PostgreSQL int2 and represented as a JavaScript number.',
  output: { codecId: 'pg/int2@1' },
} as const;

const int8Number = {
  kind: 'typeConstructor',
  documentation:
    'A signed 64-bit integer stored as PostgreSQL int8 and represented as a JavaScript number within its safe integer range.',
  output: { codecId: 'pg/int8number@1' },
} as const;

const numericString = {
  kind: 'typeConstructor',
  documentation:
    'An exact decimal value stored as PostgreSQL numeric, with optional precision and scale, and represented as decimal text.',
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
} as const;

const numericBigInt = {
  kind: 'typeConstructor',
  documentation:
    'An arbitrary-precision integer stored as PostgreSQL numeric and represented as a JavaScript bigint.',
  output: { codecId: 'pg/unboundedint@1' },
} as const;

const float4 = {
  kind: 'typeConstructor',
  documentation: 'A single-precision floating-point number stored as PostgreSQL float4.',
  output: { codecId: 'pg/float4@1' },
} as const;

const varchar = {
  kind: 'typeConstructor',
  documentation:
    'Variable-length text stored as PostgreSQL character varying, with an optional maximum character length.',
  args: [length],
  output: {
    codecId: 'sql/varchar@1',
    typeParams: { length: { kind: 'arg', index: 0 } },
  },
} as const;

const varbit = {
  kind: 'typeConstructor',
  documentation: 'A variable-length bit string with an optional maximum length in bits.',
  args: [length],
  output: {
    codecId: 'pg/varbit@1',
    typeParams: { length: { kind: 'arg', index: 0 } },
  },
} as const;

/**
 * PostgreSQL's explicit types: each names one codec, and is what the contract stores. Each is named after the database type, plus the application value where the database type has more than one codec (ADR 257, ADR 316). `Json` keeps its name until the `Json` convenience type is decided.
 */
export const postgresExplicitTypes = {
  Int2: { ...int2, inferred: true },
  Int4: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 32-bit integer stored as PostgreSQL int4 and represented as a JavaScript number.',
    output: { codecId: 'pg/int4@1' },
  },
  Int8BigInt: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A signed 64-bit integer stored as PostgreSQL int8 and represented as a JavaScript bigint.',
    output: { codecId: 'pg/int8@1' },
  },
  Int8Number: int8Number,
  NumericString: { ...numericString, inferred: true },
  NumericBigInt: numericBigInt,
  Float4: { ...float4, inferred: true },
  Float8: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A double-precision floating-point number stored as PostgreSQL float8.',
    output: { codecId: 'pg/float8@1' },
  },
  Text: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Variable-length text stored as PostgreSQL text.',
    output: { codecId: 'pg/text@1' },
  },
  Varchar: { ...varchar, inferred: true },
  Char: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'Fixed-length, blank-padded text stored as PostgreSQL character, with an optional character length.',
    args: [length],
    output: {
      codecId: 'sql/char@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Bool: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A true or false value stored as PostgreSQL bool.',
    output: { codecId: 'pg/bool@1' },
  },
  Bytea: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'Binary data stored as PostgreSQL bytea and represented as a Uint8Array.',
    output: { codecId: 'pg/bytea@1' },
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
  DateTemporal: {
    kind: 'typeConstructor',
    documentation: 'A calendar date represented as Temporal.PlainDate.',
    output: { codecId: 'pg/date-temporal@1' },
  },
  DateString: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'A PostgreSQL date represented as ISO 8601 text rather than Temporal.PlainDate.',
    output: { codecId: 'pg/date-string@1' },
  },
  TimestampString: {
    kind: 'typeConstructor',
    documentation: 'A timestamp without a time zone represented as ISO 8601 text.',
    args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzJsDate: {
    kind: 'typeConstructor',
    inferred: true,
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
    inferred: true,
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
  Varbit: { ...varbit, inferred: true },
  Xml: {
    kind: 'typeConstructor',
    inferred: true,
    documentation: 'An XML document or content fragment stored as PostgreSQL xml.',
    output: { codecId: 'pg/xml@1' },
  },
  Oid: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'An object identifier: an unsigned 32-bit integer stored as PostgreSQL oid and represented as a JavaScript number.',
    output: { codecId: 'pg/oid@1' },
  },
  Money: {
    kind: 'typeConstructor',
    inferred: true,
    documentation:
      'A currency amount in cents stored as PostgreSQL money and represented as decimal text with two fraction digits, such as "-1234.56".',
    output: { codecId: 'pg/money@1' },
  },
  IntervalParts: {
    kind: 'typeConstructor',
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
    inferred: true,
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
 * The explicit types' former names, kept for one release line as deprecated aliases. Each gives the same codec as its replacement, and the PSL interpreter warns where one is written (ADR 257).
 */
export const postgresDeprecatedScalarTypes = {
  SmallInt: { ...int2, deprecated: { replacement: 'Int2' } },
  BigIntNumber: { ...int8Number, deprecated: { replacement: 'Int8Number' } },
  Numeric: { ...numericString, deprecated: { replacement: 'NumericString' } },
  UnboundedInt: { ...numericBigInt, deprecated: { replacement: 'NumericBigInt' } },
  Real: { ...float4, deprecated: { replacement: 'Float4' } },
  VarChar: { ...varchar, deprecated: { replacement: 'Varchar' } },
  VarBit: { ...varbit, deprecated: { replacement: 'Varbit' } },
} as const satisfies AuthoringTypeNamespace;

const precision = {
  kind: 'value',
  dataType: PG_SIZE_TYPE,
  name: 'precision',
  optional: true,
} as const;

/**
 * The convenience date and time types. Each is a type choice: its `as` and `storage` arguments choose the explicit type it becomes, and `precision` is passed on to that type. ADR 279.
 */
export const postgresConvenienceDateTimeTypes = {
  DateTime: {
    kind: 'typeChoice',
    documentation:
      'A moment in time. `as` is what the application reads: jsDate (a JavaScript Date), temporal (Temporal.Instant) or string. `storage` is timestamptz or timestamp, a timestamp read and written as UTC.',
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
        values: ['timestamptz', 'timestamp'],
        default: 'timestamptz',
        optional: true,
      },
      precision,
    ],
    choices: [
      {
        when: { as: 'jsDate', storage: 'timestamptz' },
        type: 'TimestamptzJsDate',
        defaults: { precision: 3 },
      },
      { when: { as: 'temporal', storage: 'timestamptz' }, type: 'TimestamptzTemporal' },
      { when: { as: 'string', storage: 'timestamptz' }, type: 'TimestamptzString' },
      {
        when: { as: 'jsDate', storage: 'timestamp' },
        type: 'TimestampJsDate',
        defaults: { precision: 3 },
      },
      { when: { as: 'temporal', storage: 'timestamp' }, type: 'TimestampInstant' },
      { when: { as: 'string', storage: 'timestamp' }, type: 'TimestampString' },
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
      'A time of day. `as` is what the application reads: string, such as "09:30:00", or temporal (Temporal.PlainTime). `storage` is time, or timetz with as: string.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      {
        kind: 'option',
        name: 'storage',
        values: ['time', 'timetz'],
        default: 'time',
        optional: true,
      },
      precision,
    ],
    choices: [
      { when: { as: 'string', storage: 'time' }, type: 'TimeString' },
      { when: { as: 'temporal', storage: 'time' }, type: 'TimeTemporal' },
      { when: { as: 'string', storage: 'timetz' }, type: 'Timetz' },
    ],
  },
  Duration: {
    kind: 'typeChoice',
    documentation:
      'A length of time. `as` is what the application reads: string, an ISO 8601 duration such as "P1M", or parts, the object { months, days, micros }.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'parts'],
        default: 'string',
        optional: true,
      },
      {
        kind: 'option',
        name: 'storage',
        values: ['interval'],
        default: 'interval',
        optional: true,
      },
      precision,
    ],
    choices: [
      { when: { as: 'string', storage: 'interval' }, type: 'IntervalString' },
      { when: { as: 'parts', storage: 'interval' }, type: 'IntervalParts' },
    ],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * The convenience types of PostgreSQL's other scalars. Each is a type choice: `storage` chooses the database type and, for `BigInt`, `as` chooses the application value; `precision`, `scale` and `length` are passed on to the explicit type chosen. ADR 279, ADR 316.
 */
export const postgresConvenienceScalarTypes = {
  Int: {
    kind: 'typeChoice',
    documentation:
      'An integer read as a JavaScript number. `storage` is int4, a 32-bit integer, or int2, a 16-bit integer.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['int4', 'int2'],
        default: 'int4',
        optional: true,
      },
    ],
    choices: [
      { when: { storage: 'int4' }, type: 'Int4' },
      { when: { storage: 'int2' }, type: 'Int2' },
    ],
  },
  BigInt: {
    kind: 'typeChoice',
    documentation:
      'An integer that may exceed 32 bits. `as` is what the application reads: bigint, or number within the safe integer range. `storage` is int8, a 64-bit integer, or numeric, an integer of any size, with as: bigint.',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['bigint', 'number'],
        default: 'bigint',
        optional: true,
      },
      {
        kind: 'option',
        name: 'storage',
        values: ['int8', 'numeric'],
        default: 'int8',
        optional: true,
      },
    ],
    choices: [
      { when: { as: 'bigint', storage: 'int8' }, type: 'Int8BigInt' },
      { when: { as: 'number', storage: 'int8' }, type: 'Int8Number' },
      { when: { as: 'bigint', storage: 'numeric' }, type: 'NumericBigInt' },
    ],
  },
  Float: {
    kind: 'typeChoice',
    documentation:
      'A floating-point number. `storage` is float8, double precision, or float4, single precision.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['float8', 'float4'],
        default: 'float8',
        optional: true,
      },
    ],
    choices: [
      { when: { storage: 'float8' }, type: 'Float8' },
      { when: { storage: 'float4' }, type: 'Float4' },
    ],
  },
  Decimal: {
    kind: 'typeChoice',
    documentation:
      'An exact decimal number, read as decimal text such as "12.50". `storage` is numeric, with optional precision and scale.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['numeric'],
        default: 'numeric',
        optional: true,
      },
      precision,
      { kind: 'value', dataType: PG_SIZE_TYPE, name: 'scale', optional: true },
    ],
    choices: [{ when: { storage: 'numeric' }, type: 'NumericString' }],
  },
  String: {
    kind: 'typeChoice',
    documentation:
      'Text. `storage` is text, of any length, or varchar or char, which take an optional length.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['text', 'varchar', 'char'],
        default: 'text',
        optional: true,
      },
      length,
    ],
    choices: [
      { when: { storage: 'text' }, type: 'Text' },
      { when: { storage: 'varchar' }, type: 'Varchar' },
      { when: { storage: 'char' }, type: 'Char' },
    ],
  },
  Boolean: {
    kind: 'typeChoice',
    documentation: 'A true or false value. `storage` is bool.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['bool'],
        default: 'bool',
        optional: true,
      },
    ],
    choices: [{ when: { storage: 'bool' }, type: 'Bool' }],
  },
  Bytes: {
    kind: 'typeChoice',
    documentation: 'Binary data, read as a Uint8Array. `storage` is bytea.',
    args: [
      {
        kind: 'option',
        name: 'storage',
        values: ['bytea'],
        default: 'bytea',
        optional: true,
      },
    ],
    choices: [{ when: { storage: 'bytea' }, type: 'Bytea' }],
  },
} as const satisfies AuthoringTypeNamespace;

/**
 * PostgreSQL's scalar types: the explicit types, the convenience types and the deprecated aliases. It is not the whole `type` namespace: the target contributes it together with `postgresAuthoringTypes`, which adds the namespaced `sql.*`, `temporal.*` and `pg.enum` and the generated-ID aliases such as `UuidString`.
 */
export const postgresScalarTypes = {
  ...postgresExplicitTypes,
  ...postgresConvenienceDateTimeTypes,
  ...postgresConvenienceScalarTypes,
  ...postgresDeprecatedScalarTypes,
} as const satisfies AuthoringTypeNamespace;
