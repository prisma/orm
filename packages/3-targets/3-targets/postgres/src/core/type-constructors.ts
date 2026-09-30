import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { PG_TIMESTAMPTZ_DATE_CODEC_ID } from './codec-ids';
import { NUMERIC_PRECISION_RANGE, NUMERIC_SCALE_RANGE } from './numeric-limits';

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel, with explicit `nativeType` values pinned to the codec manifests
 * (`codecLookup.targetTypesFor(codecId)[0]`).
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@default(uuid())`) never re-picks a column's storage.
 *
 * These and `postgresNativeAuthoringTypes` are defined here, next to the codecs they name, but the adapter contributes them: the TypeScript contract builder builds its `type.*` helpers from the target, so a target contribution would add `type.String()` and the like there.
 */
export const postgresScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Variable-length text stored as PostgreSQL text.',
    output: { codecId: 'pg/text@1', nativeType: 'text' },
  },
  Boolean: {
    kind: 'typeConstructor',
    documentation: 'A true or false value stored as PostgreSQL boolean.',
    output: { codecId: 'pg/bool@1', nativeType: 'bool' },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'A signed 32-bit integer represented as a JavaScript number.',
    output: { codecId: 'pg/int4@1', nativeType: 'int4' },
  },
  BigInt: {
    kind: 'typeConstructor',
    documentation: 'A signed 64-bit integer represented as a JavaScript bigint.',
    output: { codecId: 'pg/int8@1', nativeType: 'int8' },
  },
  Float: {
    kind: 'typeConstructor',
    documentation: 'A double-precision floating-point number.',
    output: { codecId: 'pg/float8@1', nativeType: 'float8' },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'An exact decimal value stored as PostgreSQL numeric.',
    output: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as PostgreSQL timestamptz and represented as Temporal.Instant.',
    output: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
  },
  Json: {
    kind: 'typeConstructor',
    documentation: 'A JSON value stored as PostgreSQL json.',
    output: { codecId: 'pg/json@1', nativeType: 'json' },
  },
  Jsonb: {
    kind: 'typeConstructor',
    documentation: 'A JSON value stored in PostgreSQL binary jsonb format.',
    output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
  },
  Bytes: {
    kind: 'typeConstructor',
    documentation: 'Binary data stored as PostgreSQL bytea.',
    output: { codecId: 'pg/bytea@1', nativeType: 'bytea' },
  },
} as const satisfies AuthoringTypeNamespace;

export const postgresNativeAuthoringTypes = {
  VarChar: {
    kind: 'typeConstructor',
    documentation: 'Variable-length text with an optional maximum character length.',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Char: {
    kind: 'typeConstructor',
    documentation: 'Fixed-length, blank-padded text with an optional character length.',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    documentation: 'An exact decimal value with optional precision and scale.',
    args: [
      {
        kind: 'number',
        name: 'precision',
        integer: true,
        minimum: NUMERIC_PRECISION_RANGE.min,
        maximum: NUMERIC_PRECISION_RANGE.max,
        optional: true,
      },
      {
        kind: 'number',
        name: 'scale',
        integer: true,
        minimum: NUMERIC_SCALE_RANGE.min,
        maximum: NUMERIC_SCALE_RANGE.max,
        optional: true,
      },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Timestamp: {
    kind: 'typeConstructor',
    documentation: 'A date and time without a time zone, represented as Temporal.PlainDateTime.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timestamptz: {
    kind: 'typeConstructor',
    documentation:
      'An instant represented as Temporal.Instant, with optional fractional-second precision.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Time: {
    kind: 'typeConstructor',
    documentation: 'A time of day without a time zone, represented as Temporal.PlainTime.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/time-temporal@1',
      nativeType: 'time',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timetz: {
    kind: 'typeConstructor',
    documentation: 'A time of day with a UTC offset stored as PostgreSQL timetz.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timetz@1',
      nativeType: 'timetz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Uuid: {
    kind: 'typeConstructor',
    documentation: 'A universally unique identifier stored as PostgreSQL uuid.',
    output: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
  },
  Inet: {
    kind: 'typeConstructor',
    documentation: 'An IPv4 or IPv6 address with an optional subnet mask.',
    output: { codecId: 'pg/inet@1', nativeType: 'inet' },
  },
  SmallInt: {
    kind: 'typeConstructor',
    documentation: 'A signed 16-bit integer represented as a JavaScript number.',
    output: { codecId: 'pg/int2@1', nativeType: 'int2' },
  },
  Real: {
    kind: 'typeConstructor',
    documentation: 'A single-precision floating-point number.',
    output: { codecId: 'pg/float4@1', nativeType: 'float4' },
  },
  Date: {
    kind: 'typeConstructor',
    documentation: 'A calendar date represented as Temporal.PlainDate.',
    output: { codecId: 'pg/date-temporal@1', nativeType: 'date' },
  },
  // The representation-explicit spellings. Same columns, same precision, same native types — the
  // only difference is that a read hands back PostgreSQL's own text instead of a `Temporal.*`, so a
  // value Temporal cannot express still round-trips. Authoring-only: they claim no introspection
  // mapping, because a bare `timestamptz` column introspects to the Temporal-backed name.
  DateString: {
    kind: 'typeConstructor',
    documentation: 'A PostgreSQL date represented as database text rather than Temporal.PlainDate.',
    output: { codecId: 'pg/date-string@1', nativeType: 'date' },
  },
  TimestampString: {
    kind: 'typeConstructor',
    documentation: 'A timestamp without a time zone represented as PostgreSQL text.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamp-string@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzJsDate: {
    kind: 'typeConstructor',
    documentation:
      'An instant stored as PostgreSQL timestamptz and represented as a JavaScript Date.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzString: {
    kind: 'typeConstructor',
    documentation: 'A timestamp with time zone represented as PostgreSQL text.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamptz-string@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimeString: {
    kind: 'typeConstructor',
    documentation: 'A time of day without a time zone represented as PostgreSQL text.',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/time-string@1',
      nativeType: 'time',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;
