/**
 * MySQL's built-in aggregate result matrix, as descriptors.
 *
 * Every row was read off a live MySQL 8.4 (`SHOW CREATE TABLE` of a table created from the aggregate over a column of each codec's type): `count` is a `bigint`; `sum` over `int` is a `decimal(32,0)` and over `bigint` a `decimal(41,0)`, free to leave the range a `bigint` holds; `avg` over an integer is a `decimal`; `min`/`max` return the input's own type.
 *
 * The defaults policy is PostgreSQL's: `count` and `sum` over integers answer as a JS `number`, throwing through the codec's safe-range guard where the value cannot be one, while `countBigInt` and `sumBigInt` answer as a `bigint`. `avg` over an integer is written `CAST(SUM(x) AS DOUBLE) / COUNT(x)`: the exact decimal sum, rounded once to a `double` and divided. `AVG(x)` is a `decimal` that MySQL and MariaDB cut to nine decimal places when they group through a temporary table, so the mean it gives depends on the query plan. For the same reason there is no `avg` over a `decimal` and no `avgDecimal`.
 *
 * `sum` and `avg` over a `double` are a `double`. `sum` over a `decimal(p,s)` is the `decimal(min(65, p + 22), s)` both servers make of it, and its codec reference carries that precision and scale rather than the column's, since the total can need more digits than the column. A total past 65 digits may be capped to the largest value of that type, without an error, whenever the server groups the rows through a temporary table, which depends on the query plan: a `groupBy` on a column without an index is one example.
 *
 * `sum` and `avg` over text, dates and times are left out: MySQL reads text as a number, warning, and a date or time as its digits run together, so neither has a result this target can type. `min`/`max` over a duration are left out too, since its text does not sort in the order of the durations.
 */

import type { JsonValue } from '@internal/contract/types';
import { type CodecRef, dataTypeParams } from '@internal/framework-components/codec';
import type { ValueInputAggregateDescriptor } from '@internal/framework-components/components';
import type { SqlAggregateLowering } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import type { AggregateFn } from '@internal/sql-relational-core/ast';
import { AggregateExpr, CastExpr, OperationExpr } from '@internal/sql-relational-core/ast';
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
  MYSQL_INT_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { MYSQL_WIDEST_DECIMAL, mysqlDecimal, mysqlDecimalColumnOfReference } from './data-types';

type ValueInput = ValueInputAggregateDescriptor['input'];

const preservesInput = <const Operation extends string, const Input extends ValueInput>(
  operation: Operation,
  input: Input,
) =>
  ({
    operation,
    input,
    output: { kind: 'self' },
    nullable: true,
  }) as const;

const produces = <
  const Operation extends string,
  const Input extends ValueInput,
  const CodecId extends string,
>(
  operation: Operation,
  input: Input,
  codecId: CodecId,
) =>
  ({
    operation,
    input,
    output: { kind: 'codec', codecId },
    nullable: true,
  }) as const;

const producesVia = <
  const Operation extends string,
  const Input extends ValueInput,
  const CodecId extends string,
>(
  operation: Operation,
  input: Input,
  codecId: CodecId,
  lower: SqlAggregateLowering,
) => ({ ...produces(operation, input, codecId), lower }) as const;

const computedWith =
  (fn: AggregateFn): SqlAggregateLowering =>
  ({ expr }) =>
    new AggregateExpr(fn, expr);

const meanAsDouble: SqlAggregateLowering = ({ expr }) =>
  new OperationExpr({
    method: 'avg',
    self: CastExpr.as(new AggregateExpr('sum', expr), 'DOUBLE'),
    args: [new AggregateExpr('count', expr)],
    returns: { codecId: MYSQL_DOUBLE_CODEC_ID, nullable: true },
    lowering: { targetFamily: 'sql', template: '{{self}} / {{arg0}}' },
  });

/** The 22 digits before the point that `sum` adds to a `decimal` column's precision, up to the widest decimal. */
const DECIMAL_SUM_EXTRA_DIGITS = 22;

/** The precision and scale of the total of a `decimal` column; a reference without a precision is of no column, and so is its total. */
const decimalSumParams = (input: CodecRef | undefined): JsonValue | undefined => {
  const column = mysqlDecimalColumnOfReference(dataTypeParams(mysqlDecimal, input?.typeParams));
  if (column === undefined) return undefined;
  return {
    precision: Math.min(
      MYSQL_WIDEST_DECIMAL.precision,
      column.precision + DECIMAL_SUM_EXTRA_DIGITS,
    ),
    scale: column.scale,
  };
};

const INTEGER_CODECS = [
  MYSQL_INT_CODEC_ID,
  MYSQL_BIGINT_CODEC_ID,
  MYSQL_BIGINT_NUMBER_CODEC_ID,
] as const;

const MIN_MAX_PRESERVING_CODECS = [
  MYSQL_DATETIME_CODEC_ID,
  MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  MYSQL_DATETIME_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_DATE_STRING_CODEC_ID,
  MYSQL_DATE_TEMPORAL_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
] as const;

const orderingDescriptors = <const Operation extends 'min' | 'max'>(operation: Operation) =>
  [
    preservesInput(operation, { kind: 'trait', trait: 'numeric' }),
    preservesInput(operation, { kind: 'trait', trait: 'textual' }),
    ...MIN_MAX_PRESERVING_CODECS.map((codecId) =>
      preservesInput(operation, { kind: 'codec', codecId }),
    ),
  ] as const;

/**
 * Every aggregate overload the MySQL target contributes. The adapter lists these on `types.aggregateDescriptors`, from where emission derives result types and the runtime builds its resolution registry.
 */
export const mysqlAggregateDescriptors = [
  {
    operation: 'count',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: MYSQL_BIGINT_NUMBER_CODEC_ID },
    nullable: false,
    emptyResultWire: '0',
  },
  {
    operation: 'countBigInt',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: MYSQL_BIGINT_CODEC_ID },
    nullable: false,
    emptyResultWire: '0',
    lower: computedWith('count'),
  },

  ...INTEGER_CODECS.map((codecId) =>
    produces('sum', { kind: 'codec', codecId }, MYSQL_BIGINT_NUMBER_CODEC_ID),
  ),
  ...INTEGER_CODECS.map((codecId) =>
    producesVia(
      'sumBigInt',
      { kind: 'codec', codecId },
      MYSQL_BIGINT_CODEC_ID,
      computedWith('sum'),
    ),
  ),

  ...INTEGER_CODECS.map((codecId) =>
    producesVia('avg', { kind: 'codec', codecId }, MYSQL_DOUBLE_CODEC_ID, meanAsDouble),
  ),

  produces('sum', { kind: 'codec', codecId: MYSQL_DOUBLE_CODEC_ID }, MYSQL_DOUBLE_CODEC_ID),
  produces('avg', { kind: 'codec', codecId: MYSQL_DOUBLE_CODEC_ID }, MYSQL_DOUBLE_CODEC_ID),
  {
    operation: 'sum',
    input: { kind: 'codec', codecId: MYSQL_DECIMAL_CODEC_ID },
    output: { kind: 'codec', codecId: MYSQL_DECIMAL_CODEC_ID, typeParams: decimalSumParams },
    nullable: true,
  },

  ...orderingDescriptors('min'),
  ...orderingDescriptors('max'),
] as const;
