/**
 * SQLite's built-in aggregate result matrix, as descriptors.
 *
 * Every row was read off a live SQLite 3.53 (`typeof(<aggregate>(<column>))` over a column of each built-in codec's storage type). SQLite types values, not columns, so what a probe reports is the storage class of the aggregate's result: `sum` over integers stays `integer`, `sum` over reals is `real`, `avg` is `real` for every input, and `min`/`max` return a value of the input's own class.
 *
 * What the database computes and what the application reads are two questions, and the defaults policy answers the second: `count` and `sum` over integers answer as a JS `number` — throwing through the codec's safe-range guard where the value cannot be one — while `countBigInt` and `sumBigInt` answer losslessly. `avg` is already a `real` and so already a `number`, and there is no `avgDecimal`: an exact mean would need a decimal result codec, which SQLite has none of.
 *
 * Two SQLite behaviours shape which pairs get a descriptor at all:
 *
 * - **`sum` of integers does not widen.** An `INTEGER` sum that exceeds a 64-bit integer raises `integer overflow` rather than promoting to a float, so the result is an integer or it is nothing. That raise is the bound `sumBigInt` is offered within — a declared limit of the target, not a gap in it. Neither integer form is `sqlite/integer@1`: a sum of small integers is free to exceed 2^53 while remaining a perfectly good SQLite integer, which `sqlite/bigint@1` carries exactly and `sqlite/bigintnumber@1` refuses rather than rounds.
 * - **`sum` and `avg` coerce rather than refuse.** Over `TEXT` or `BLOB`, SQLite reads a leading number where it can and 0 otherwise, so `sum` over a column of words is `0.0` and over a column of numerals is their total — a result whose very storage class depends on the rows. No descriptor claims those pairs: an aggregate whose result cannot be typed from the schema is one this target declines to offer, and the conformance suite pins the list of pairs left unclaimed for that reason.
 *
 * Result identity is declared; lowering hooks build the expression. A descriptor whose result is an integer wider than a JS number casts the aggregate to text (`castResultToText`) so the value survives the driver's numeric reads and the range error is the codec's own; a lossless variant computes with the SQL aggregate its bare namesake uses, since its name is not the database's. A hook returns an expression and nothing else, so which codec the result carries stays the descriptor's to declare.
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import type { ValueInputAggregateDescriptor } from '@internal/framework-components/components';
import type {
  SqlAggregateDescriptor,
  SqlAggregateLowering,
} from '@internal/sql-relational-core/aggregate-descriptor-registry';
import type { AggregateFn } from '@internal/sql-relational-core/ast';
import { AggregateExpr, CastExpr } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import {
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BIGINT_NUMBER_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
} from './codec-ids';

/** The input matches available to an overload that consumes a value — the only ones these helpers build, since every aggregate here but `count` needs something to fold. */
type ValueInput = ValueInputAggregateDescriptor['input'];

const overCodec = (codecId: string): ValueInput => ({ kind: 'codec', codecId });
const overTrait = (trait: CodecTrait): ValueInput => ({ kind: 'trait', trait });

/** An aggregate whose result is one of the input values, so it carries the input's codec. */
const preservesInput = (operation: AggregateFn, input: ValueInput): SqlAggregateDescriptor => ({
  operation,
  input,
  output: { kind: 'self' },
  nullable: true,
});

/**
 * Render the aggregate as text.
 *
 * SQLite computes an aggregate into an INTEGER, and the driver reads an integer
 * no JS number can hold as an error rather than a value — so an aggregate whose
 * result is a wide integer leaves the database through this cast, which is the
 * form both integer codecs read anyway. The hook builds the expression and
 * nothing else: which codec the result carries is the descriptor's `output` to
 * declare, not this function's to choose.
 *
 * The `operation` it names is the SQL aggregate the row computes with — its own
 * name for a bare operation, its bare namesake's for a lossless variant, whose
 * name the database does not know.
 */
const castResultToText =
  (operation: AggregateFn): SqlAggregateLowering =>
  ({ expr }) =>
    CastExpr.as(new AggregateExpr(operation, expr), 'text');

/** The integer results wider than the driver's numeric reads: one read exactly, one read as a `number` and guarded against the safe range. Both leave the database as text. */
const WIDE_INTEGER_CODECS: readonly string[] = [
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BIGINT_NUMBER_CODEC_ID,
];

/** An aggregate whose result is a new value, named by codec and without the input's type parameters. */
const produces = (
  operation: AggregateFn,
  input: ValueInput,
  codecId: string,
): SqlAggregateDescriptor => ({
  operation,
  input,
  output: { kind: 'codec', codecId },
  nullable: true,
  ...ifDefined(
    'lower',
    WIDE_INTEGER_CODECS.includes(codecId) ? castResultToText(operation) : undefined,
  ),
});

/** The same, for a lossless variant: an operation whose name the SQL alphabet does not carry, so its lowering names the aggregate it computes with. */
const producesVia = (
  operation: string,
  input: ValueInput,
  codecId: string,
  lower: SqlAggregateLowering,
): SqlAggregateDescriptor => ({
  operation,
  input,
  output: { kind: 'codec', codecId },
  nullable: true,
  lower,
});

/** Codecs stored as SQLite integers. Their `sum` is an integer of up to 64 bits — past `sqlite/integer@1`'s range, and past the safe-integer range too, since a total of safe-range values is free to leave it. The bare form therefore guards and the lossless one carries. */
const INTEGER_CODECS = [
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BIGINT_NUMBER_CODEC_ID,
  SQL_INT_CODEC_ID,
] as const;

/** Codecs stored as SQLite reals. Their `sum` stays real. */
const REAL_CODECS = [SQLITE_REAL_CODEC_ID, SQL_FLOAT_CODEC_ID] as const;

/**
 * Codecs whose `min`/`max` returns the input value and whose traits do not already say so: SQLite compares blobs bytewise and text by its collation, so a datetime, a JSON document, and a blob each have a well-defined least and greatest — unlike the numeric and textual codecs, whose traits carry them.
 */
const MIN_MAX_PRESERVING_CODECS = [
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
] as const;

const orderingDescriptors = (operation: 'min' | 'max'): ReadonlyArray<SqlAggregateDescriptor> => [
  preservesInput(operation, overTrait('numeric')),
  preservesInput(operation, overTrait('textual')),
  ...MIN_MAX_PRESERVING_CODECS.map((codecId) => preservesInput(operation, overCodec(codecId))),
  // The bigint codec claims itself exactly, so its extremum leaves the database
  // as text like every other bigint result; the trait fallback above serves the
  // numeric codecs whose values a JS number holds.
  {
    operation,
    input: { kind: 'codec', codecId: SQLITE_BIGINT_CODEC_ID },
    output: { kind: 'self' },
    nullable: true,
    lower: castResultToText(operation),
  },
];

/**
 * Every aggregate overload the SQLite target contributes. The adapter lists these on `types.aggregateDescriptors`, from where emission derives result types and the runtime builds its resolution registry.
 */
export const sqliteAggregateDescriptors: ReadonlyArray<SqlAggregateDescriptor> = [
  // `count` returns an integer whether it counts rows or non-null values, which is what makes it input-agnostic rather than merely input-less. A row count is a `number` to a JS developer, so that is what the bare operation reads it as — and outside ±(2^53 − 1) it throws rather than answer with a rounded tally.
  {
    operation: 'count',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: SQLITE_BIGINT_NUMBER_CODEC_ID },
    nullable: false,
    emptyResultJson: '0',
    lower: castResultToText('count'),
  },
  {
    operation: 'countBigInt',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: SQLITE_BIGINT_CODEC_ID },
    nullable: false,
    emptyResultJson: '0',
    lower: castResultToText('count'),
  },

  // A `sum` of integers reads as a `number` whichever width the column has, and as an exact `bigint` through the variant — offered over every integer input, including those whose bare total a `number` already holds, so the escape hatch is one name rather than a rule about widths.
  ...INTEGER_CODECS.map((codecId) =>
    produces('sum', overCodec(codecId), SQLITE_BIGINT_NUMBER_CODEC_ID),
  ),
  ...INTEGER_CODECS.map((codecId) =>
    producesVia('sumBigInt', overCodec(codecId), SQLITE_BIGINT_CODEC_ID, castResultToText('sum')),
  ),
  ...REAL_CODECS.map((codecId) => produces('sum', overCodec(codecId), SQLITE_REAL_CODEC_ID)),

  // `avg` is real for every input, integers included — already the `number` the defaults policy asks for, and with no exact form to offer beside it.
  ...[...INTEGER_CODECS, ...REAL_CODECS].map((codecId) =>
    produces('avg', overCodec(codecId), SQLITE_REAL_CODEC_ID),
  ),

  ...orderingDescriptors('min'),
  ...orderingDescriptors('max'),
];
