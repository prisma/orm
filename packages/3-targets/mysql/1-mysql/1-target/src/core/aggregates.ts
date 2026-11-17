/**
 * MySQL's built-in aggregate result matrix, as descriptors.
 *
 * Every row was read off a live MySQL 8.4 (`SHOW CREATE TABLE` of a table created from the aggregate over a column of each codec's type): `count` is a `bigint`; `sum` over `int` is a `decimal(32,0)` and over `bigint` a `decimal(41,0)`, free to leave the range a `bigint` holds; `avg` over an integer is a `decimal`; `min`/`max` return the input's own type.
 *
 * The defaults policy is PostgreSQL's: `count` and `sum` over integers answer as a JS `number`, throwing through the codec's safe-range guard where the value cannot be one, while `countBigInt` and `sumBigInt` answer as a `bigint`. `avg` over an integer is written `CAST(SUM(x) AS DOUBLE) / COUNT(x)`: the exact decimal sum, rounded once to a `double` and divided. `AVG(x)` is a `decimal` that MySQL and MariaDB cut to nine decimal places when they group through a temporary table, so the mean it gives depends on the query plan. There is no `avgDecimal`: MySQL has no decimal codec yet.

Only codecs a column can be authored with take an input: `mysql/bigintnumber@1` and `mysql/double@1` are result codecs, with no authoring name yet.
 *
 * `sum` and `avg` over text, dates and times are left out: MySQL reads text as a number, warning, and a date or time as its digits run together, so neither has a result this target can type. `min`/`max` over a duration are left out too, since its text does not sort in the order of the durations.
 */

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
  MYSQL_DOUBLE_CODEC_ID,
  MYSQL_INT_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';

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

const INTEGER_CODECS = [MYSQL_INT_CODEC_ID, MYSQL_BIGINT_CODEC_ID] as const;

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

  ...orderingDescriptors('min'),
  ...orderingDescriptors('max'),
] as const;
