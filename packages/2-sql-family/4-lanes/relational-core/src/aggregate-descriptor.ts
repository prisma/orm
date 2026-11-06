import type { CodecRef } from '@internal/framework-components/codec';
import type { AggregateDescriptor } from '@internal/framework-components/components';
import { isAggregateDescriptor } from '@internal/framework-components/components';
import type { AnyExpression } from './ast/types';

/**
 * What a lowering hook is handed: the expression being aggregated (absent for operations that consume no value) and the codec of that expression.
 */
export interface SqlAggregateLoweringContext {
  readonly expr: AnyExpression | undefined;
  readonly inputCodec: CodecRef | undefined;
}

/**
 * Builds the expression that computes an aggregate — a plain aggregate call, or a call wrapped in whatever the target needs to reach the declared result type.
 *
 * A hook returns an expression and nothing else, so lowering can never disagree with the descriptor's declared `output` about which codec the result carries.
 */
export type SqlAggregateLowering = (context: SqlAggregateLoweringContext) => AnyExpression;

/**
 * The SQL specialization of {@link AggregateDescriptor}: the same declarative `(operation, input) -> output codec + nullability` mapping, plus an optional hook that builds the expression.
 *
 * Targets and extensions contribute these through `types.aggregateDescriptors`; the runtime assembles them into a `SqlAggregateDescriptorRegistry` once at execution-context construction.
 *
 * Operation names are an open namespace, but the AST's `AggregateFn` alphabet is closed: an operation named in the alphabet lowers to a plain `AggregateExpr(operation, expr)` by default, while a descriptor for any other operation must carry `lower` — registry assembly rejects it otherwise with `RUNTIME.AGGREGATE_LOWERING_MISSING`.
 */
export type SqlAggregateDescriptor = AggregateDescriptor & {
  readonly lower?: SqlAggregateLowering;
};

/** Structural validation of a contributed SQL aggregate descriptor: the declarative shape plus a callable lowering hook where one is declared. */
export function isSqlAggregateDescriptor(value: unknown): value is SqlAggregateDescriptor {
  if (!isAggregateDescriptor(value)) return false;
  return !('lower' in value) || value.lower === undefined || typeof value.lower === 'function';
}
