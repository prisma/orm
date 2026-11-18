/**
 * Where an aggregate's result codec comes from, for every ORM path that needs one.
 *
 * Planning asks so it can stamp the codec on the projected value; decoding asks so it can turn the JSON the database produced back into an application value. Both ask the same registry the same question, so a result cannot be projected under one codec and read under another.
 */

import type { Contract } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type { AggregateResultNullability } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlAggregateLowering } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AggregateExpr,
  type AnyExpression,
  isAggregateFn,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { ormError } from './orm-errors';

export type ResolvedAggregate = AggregateResultNullability & {
  /** The codec the result carries. */
  readonly codec: CodecRef;
  /** The codec of the value being aggregated, absent for an aggregate over rows. A lowering reads it to render per input where it must. */
  readonly input: CodecRef | undefined;
  /** Builds the expression, where the target declares one; absent means a plain aggregate call. */
  readonly lower: SqlAggregateLowering | undefined;
};

export interface AggregateCodecQuery {
  readonly aggregates: SqlAggregateDescriptorRegistry;
  readonly contract: Contract<SqlStorage>;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly fn: string;
  /** The column being aggregated, absent for an aggregate over rows. */
  readonly column: string | undefined;
}

/**
 * What an aggregate resolves to: the codec its result carries, and the expression the target wants built for it.
 *
 * An aggregate over a column resolves against that column's own codec, so a target that widens `sum` over small integers and preserves it over decimals answers differently per column without the caller knowing either rule. Where a target also needs the result rendered a particular way — a value its driver cannot otherwise carry — the descriptor's lowering says so, and the codec it declared stays the codec regardless.
 *
 * A pair the composed stack declares no overload for is rejected before any SQL is built: an undeclared aggregate has no result identity to project or decode, and executing it anyway would hand back the driver-native value the declared-codec path exists to replace.
 */
export function resolveAggregate(query: AggregateCodecQuery): ResolvedAggregate {
  const input = inputCodecRef(query);
  const resolved = query.aggregates.resolve(query.fn, input);
  if (resolved === undefined) throw unsupportedAggregate(query, input);
  const nullability: AggregateResultNullability = resolved.nullable
    ? { nullable: true }
    : { nullable: false, emptyResultWire: resolved.emptyResultWire };
  return { codec: resolved.output, ...nullability, input, lower: resolved.lower };
}

/**
 * The plain SQL form of an operation in the closed aggregate alphabet.
 * Registry composition guarantees every operation outside the alphabet
 * carries a lowering hook, so a resolution without one for any other name is
 * a composition bug, not a user error.
 */
export function plainAggregateExpr(fn: string, expr: AnyExpression | undefined): AggregateExpr {
  if (!isAggregateFn(fn)) {
    throw new InternalError(
      `aggregate operation '${fn}' is outside the SQL aggregate alphabet and resolved without a lowering hook`,
    );
  }
  return new AggregateExpr(fn, expr);
}

function unsupportedAggregate(query: AggregateCodecQuery, input: CodecRef | undefined) {
  return ormError(
    'ORM.AGGREGATE_UNSUPPORTED',
    input === undefined
      ? `The composed target declares no '${query.fn}' aggregate for a call without an input.`
      : `The composed target declares no '${query.fn}' aggregate over codec '${input.codecId}' (column '${query.column}' of table '${query.tableName}').`,
    {
      why: 'An aggregate result decodes through the codec its target declares; an undeclared pair has no declared result to type or decode.',
      fix: `Aggregate a column the target declares '${query.fn}' for, or contribute an aggregate descriptor for this pair.`,
      meta: {
        operation: query.fn,
        table: query.tableName,
        ...ifDefined('column', query.column),
        ...ifDefined('inputCodecId', input?.codecId),
      },
    },
  );
}

/** The codec of the value being aggregated — the column's own, or none where the aggregate is over rows. */
function inputCodecRef(query: AggregateCodecQuery): CodecRef | undefined {
  return query.column === undefined
    ? undefined
    : codecRefForStorageColumn(
        query.contract.storage,
        query.namespaceId,
        query.tableName,
        query.column,
      );
}
