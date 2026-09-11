import type { Contract } from '@internal/contract/types';
import type { AsyncIterableResult, QueryPlan } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyQueryAst } from './ast/types';

/**
 * Shared SQL preparation envelope produced by lanes before lowering.
 * Consumer metadata is optional; ordinary SQL plans need no identity consumer.
 *
 * Lanes build ASTs and metadata but do not perform SQL lowering. The `sql`
 * field is absent — `RuntimeCore` (the runtime base class in
 * `@internal/framework-components/runtime`) drives lowering via the
 * SQL adapter and produces a `SqlExecutionPlan`.
 *
 * Extends the framework-level `QueryPlan<Row>` marker (`meta + _row`) and
 * adds SQL-specific fields (`ast`, `params`). The phantom `_row` property
 * (inherited from `QueryPlan`) is what `ResultType<P>` inspects to recover
 * the row type.
 */
export interface Preparable<Row = unknown, Result = unknown> extends QueryPlan<Row> {
  readonly ast: AnyQueryAst;
  readonly params: readonly unknown[];
  consume?(rows: AsyncIterableResult<Row>): Result;
}

export interface SqlQueryPlan<Row = unknown> extends Preparable<Row> {}

/**
 * Wraps an `AnyQueryAst` (typically a `RawQueryAst`, minted by a raw statement
 * terminator or package-internally by an extension's migration factory) in a
 * fully-populated `SqlQueryPlan` whose `meta` is sourced from the supplied
 * contract.
 *
 * Centralising the envelope here means consumers (raw statement terminators,
 * cipherstash migration factories) cannot drift on `storageHash` /
 * `target` / `targetFamily`, which would otherwise surface as a subtle
 * `assertContractMatches` failure inside `dataTransform`. `params` defaults
 * to `[]` because parameters embedded in the AST as `ParamRef`s are resolved
 * at lowering time (`encodeParams` walks `plan.ast.collectParamRefs()`),
 * not at plan-construction time.
 *
 * The default `laneId` of `'raw'` reflects raw-SQL plans' standard lane tag;
 * callers (e.g. a future `sql-raw-factory`) may override to differentiate
 * the plan's provenance.
 */
export function planFromAst<Row = unknown>(
  ast: AnyQueryAst,
  contract: Contract<SqlStorage>,
  laneId = 'raw',
): SqlQueryPlan<Row> {
  return {
    ast,
    params: [],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storage.storageHash,
      lane: laneId,
    },
  };
}
