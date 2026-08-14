/**
 * PostgreSQL's built-in aggregate result matrix, as descriptors.
 *
 * Every row here was read off a live PostgreSQL 17 (`pg_typeof(<aggregate>(<column>))` over a column of each built-in codec's native type), not inferred from the input codec's traits — which is the point, since PostgreSQL's own rules are neither uniform nor guessable from the input alone: `sum` over the small integers widens to `bigint` but over `bigint` goes to `numeric`; `avg` over `real` widens to `double precision` while `sum` over `real` stays `real`; `sum` and `avg` over `time` produce an `interval`; `min`/`max` over `varchar` produce `text`.
 *
 * What the database computes and what the application reads are two questions, and the defaults policy answers the second: `count`, `sum`, and `avg` over integers answer as a JS `number` — throwing through the codec's safe-range guard where the value cannot be one — while `countBigInt`, `sumBigInt`, and `avgDecimal` answer losslessly. Bare `sum` and `avg` over a float, `numeric`, or unbounded-integer column stay in that column's own family, whose representation its author chose.
 *
 * The pairs PostgreSQL does not aggregate at all — `sum`/`avg` over anything non-numeric and non-temporal, and `min`/`max` over `bool`, `uuid`, `bytea`, `bit`, `bit varying`, `json`, and `jsonb` — carry no descriptor, so resolution reports them as unavailable rather than typing a result for an expression the database refuses to run.
 *
 * A lowering hook builds the expression wherever the operation's name is not the database's: the lossless variants compute with the SQL aggregate their bare namesakes use, and `avg` over an integer casts its result. Result identity stays declared either way — a hook returns an expression and nothing else.
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import type { ValueInputAggregateDescriptor } from '@internal/framework-components/components';
import type {
  SqlAggregateDescriptor,
  SqlAggregateLowering,
} from '@internal/sql-relational-core/aggregate-descriptor-registry';
import type { AggregateFn } from '@internal/sql-relational-core/ast';
import { AggregateExpr, CastExpr } from '@internal/sql-relational-core/ast';
import {
  PG_DATE_CODEC_ID,
  PG_DATE_STRING_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INET_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INT8_NUMBER_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UNBOUNDED_INT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from './codec-ids';

/** The input matches available to an overload that consumes a value — the only ones these helpers build, since every aggregate here but `count` needs something to fold. */
type ValueInput = ValueInputAggregateDescriptor['input'];

const overCodec = (codecId: string): ValueInput => ({ kind: 'codec', codecId });
const overTrait = (trait: CodecTrait): ValueInput => ({ kind: 'trait', trait });

/**
 * An aggregate whose result is one of the input values, so it carries the input's codec — type parameters included, since a `numeric(10,3)` minimum is still a `numeric(10,3)`.
 */
const preservesInput = (operation: string, input: ValueInput): SqlAggregateDescriptor => ({
  operation,
  input,
  output: { kind: 'self' },
  nullable: true,
});

/**
 * An aggregate whose result is a new value. It names its result codec without type parameters: a sum leaves the input's width behind (a `numeric(10,3)` column sums to an unconstrained `numeric`), so carrying the input's parameters into the result would understate the range.
 */
const produces = (
  operation: string,
  input: ValueInput,
  codecId: string,
): SqlAggregateDescriptor => ({
  operation,
  input,
  output: { kind: 'codec', codecId },
  nullable: true,
});

/** The same, for an operation that builds its own expression. */
const producesVia = (
  operation: string,
  input: ValueInput,
  codecId: string,
  lower: SqlAggregateLowering,
): SqlAggregateDescriptor => ({ ...produces(operation, input, codecId), lower });

/** The SQL aggregate a lossless variant computes with. `sumBigInt` is a `sum` read exactly, `countBigInt` a `count`, `avgDecimal` an `avg`: the variants differ in how the result is read, never in what the database computes. */
const computedWith =
  (fn: AggregateFn): SqlAggregateLowering =>
  ({ expr }) =>
    new AggregateExpr(fn, expr);

/** `avg` over an integer column, rounded once. PostgreSQL computes the exact `numeric` mean and the cast turns that one value into the `double precision` the result codec reads; casting the input instead would round every value before it was accumulated. */
const avgCastToFloat8: SqlAggregateLowering = ({ expr }) =>
  CastExpr.as(new AggregateExpr('avg', expr), 'float8');

/** Integer codecs whose `sum` widens to `bigint` — every built-in integer bar the 64-bit ones, whose sum goes to `numeric` instead. */
const SUM_WIDENS_TO_INT8 = [
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT_CODEC_ID,
  SQL_INT_CODEC_ID,
] as const;

/** The 64-bit integer codecs: PostgreSQL computes their `sum` as a `numeric`, a total free to leave the range an `int8` holds. */
const SUM_WIDENS_TO_NUMERIC = [PG_INT8_CODEC_ID, PG_INT8_NUMBER_CODEC_ID] as const;

/** The integer codecs a `sum` reads back as a `number`: every fixed-width one, whatever its own application type. */
const FIXED_WIDTH_INTEGER_CODECS = [...SUM_WIDENS_TO_INT8, ...SUM_WIDENS_TO_NUMERIC] as const;

/** Every built-in integer codec, the unbounded one included: `avg` over any of them is a `numeric` mean. */
const INTEGER_CODECS = [...FIXED_WIDTH_INTEGER_CODECS, PG_UNBOUNDED_INT_CODEC_ID] as const;

/** Codecs over `double precision`, whose `sum` and `avg` stay there. */
const DOUBLE_PRECISION_CODECS = [
  PG_FLOAT8_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
] as const;

/**
 * Codecs whose `min`/`max` returns the input type and whose traits do not already say so: the temporal types, `inet`, and `text[]` advertise `order` or `equality`, which `uuid`, `bit`, `bit varying`, `bool`, `bytea`, `json`, and `jsonb` also advertise while having no `min`/`max` at all. An exact overload per supported codec is therefore the only honest shape — a trait fallback over `order` would claim the unsupported ones too.
 */
const MIN_MAX_PRESERVING_CODECS = [
  PG_DATE_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_INET_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  // The extremum of a set of server renderings is one of those renderings, so the `*-string` codecs
  // preserve their input exactly as the codecs over the same native types do.
  PG_DATE_STRING_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
] as const;

/**
 * `min`/`max` over the character types, where the trait rung does hold: every `textual` codec returns its input type — except the two `varchar` codecs, whose result PostgreSQL widens to `text`, and which therefore claim themselves exactly and shadow the fallback.
 */
const MIN_MAX_WIDENS_TO_TEXT = [PG_VARCHAR_CODEC_ID, SQL_VARCHAR_CODEC_ID] as const;

const orderingDescriptors = (operation: 'min' | 'max'): ReadonlyArray<SqlAggregateDescriptor> => [
  preservesInput(operation, overTrait('numeric')),
  preservesInput(operation, overTrait('textual')),
  ...MIN_MAX_WIDENS_TO_TEXT.map((codecId) =>
    produces(operation, overCodec(codecId), PG_TEXT_CODEC_ID),
  ),
  ...MIN_MAX_PRESERVING_CODECS.map((codecId) => preservesInput(operation, overCodec(codecId))),
];

/**
 * Every aggregate overload the PostgreSQL target contributes. The adapter lists these on `types.aggregateDescriptors`, from where emission derives result types and the runtime builds its resolution registry.
 */
export const postgresAggregateDescriptors: ReadonlyArray<SqlAggregateDescriptor> = [
  // PostgreSQL's `count` returns `bigint` whether it counts entries or non-null values, which is what makes it input-agnostic rather than merely input-less. A row count is a `number` to a JS developer, so that is what the bare operation reads it as — and outside ±(2^53 − 1) it throws rather than answer with a rounded tally.
  {
    operation: 'count',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: PG_INT8_NUMBER_CODEC_ID },
    nullable: false,
    emptyResultJson: 0,
  },
  {
    operation: 'countBigInt',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: PG_INT8_CODEC_ID },
    nullable: false,
    emptyResultJson: '0',
    lower: computedWith('count'),
  },

  // A `sum` of integers reads as a `number` whichever width the column has: the small integers total into a `bigint` and the 64-bit ones into a `numeric`, and both arrive as decimal text the safe-range guard checks before rounding can happen.
  ...FIXED_WIDTH_INTEGER_CODECS.map((codecId) =>
    produces('sum', overCodec(codecId), PG_INT8_NUMBER_CODEC_ID),
  ),
  ...SUM_WIDENS_TO_INT8.map((codecId) =>
    producesVia('sumBigInt', overCodec(codecId), PG_INT8_CODEC_ID, computedWith('sum')),
  ),
  // The lossless sum of 64-bit integers is the `numeric` PostgreSQL computed, read as an unbounded `bigint`. Casting that total to `int8` would raise `bigint out of range` past 2^63 — an overflow this row does not have.
  ...SUM_WIDENS_TO_NUMERIC.map((codecId) =>
    producesVia('sumBigInt', overCodec(codecId), PG_UNBOUNDED_INT_CODEC_ID, computedWith('sum')),
  ),
  // The unbounded integer's own `sum` is already exact, and the variant answers over it all the same: the suffix is an escape hatch, and a caller reaching for it across integer columns should not have to learn which widths did not need it.
  producesVia(
    'sumBigInt',
    overCodec(PG_UNBOUNDED_INT_CODEC_ID),
    PG_UNBOUNDED_INT_CODEC_ID,
    computedWith('sum'),
  ),
  produces('sum', overCodec(PG_FLOAT4_CODEC_ID), PG_FLOAT4_CODEC_ID),
  ...DOUBLE_PRECISION_CODECS.map((codecId) =>
    produces('sum', overCodec(codecId), PG_FLOAT8_CODEC_ID),
  ),
  produces('sum', overCodec(PG_NUMERIC_CODEC_ID), PG_NUMERIC_CODEC_ID),
  // `sum` over the unbounded integer keeps its codec: the expression's SQL type is `numeric`, and a sum of integral values is integral, so the codec's integrality-checked `bigint` decode is the right reader for the total.
  produces('sum', overCodec(PG_UNBOUNDED_INT_CODEC_ID), PG_UNBOUNDED_INT_CODEC_ID),
  produces('sum', overCodec(PG_INTERVAL_CODEC_ID), PG_INTERVAL_CODEC_ID),
  produces('sum', overCodec(PG_TIME_CODEC_ID), PG_INTERVAL_CODEC_ID),
  produces('sum', overCodec(PG_TIME_STRING_CODEC_ID), PG_INTERVAL_CODEC_ID),

  // A mean is a fraction, so `avg` over any integer column reads as a `number`; `avgDecimal` reads the same `numeric` mean exactly.
  ...INTEGER_CODECS.map((codecId) =>
    producesVia('avg', overCodec(codecId), PG_FLOAT8_CODEC_ID, avgCastToFloat8),
  ),
  ...[...INTEGER_CODECS, PG_NUMERIC_CODEC_ID].map((codecId) =>
    producesVia('avgDecimal', overCodec(codecId), PG_NUMERIC_CODEC_ID, computedWith('avg')),
  ),
  ...[PG_FLOAT4_CODEC_ID, ...DOUBLE_PRECISION_CODECS].map((codecId) =>
    produces('avg', overCodec(codecId), PG_FLOAT8_CODEC_ID),
  ),
  produces('avg', overCodec(PG_NUMERIC_CODEC_ID), PG_NUMERIC_CODEC_ID),
  produces('avg', overCodec(PG_INTERVAL_CODEC_ID), PG_INTERVAL_CODEC_ID),
  produces('avg', overCodec(PG_TIME_CODEC_ID), PG_INTERVAL_CODEC_ID),
  produces('avg', overCodec(PG_TIME_STRING_CODEC_ID), PG_INTERVAL_CODEC_ID),

  ...orderingDescriptors('min'),
  ...orderingDescriptors('max'),
];
