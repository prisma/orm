import type { PlanMeta } from '@internal/contract/types';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
  RuntimeStatementStats,
} from '@internal/framework-components/runtime';
import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoQueryExecutor, MongoResultShape } from '@internal/mongo-query-ast/execution';
import type { MongoPreparedParamRef } from '@internal/mongo-value';
import { invariant } from '@internal/utils/assertions';
import { statisticsCountField } from '../statistics-count-field';
import type { MongoPreparedExecution, MongoPreparedStatement } from './types';

export interface MongoPreparedInternals {
  readonly meta: PlanMeta;
  readonly draft: MongoLoweredDraft;
  readonly placeholders: ReadonlyArray<MongoPreparedParamRef>;
  readonly resultShape: MongoResultShape | undefined;
}

export const mongoPreparedQuery = Symbol('mongoPreparedQuery');
export const mongoPreparedExecute = Symbol('mongoPreparedExecute');

/** The runtime's side of a prepared run. Installed on `MongoRuntimeImpl`; not exported from any public entry point. */
export interface MongoPreparedBridge {
  [mongoPreparedQuery]<Row>(
    statement: MongoPreparedInternals,
    params: unknown,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  [mongoPreparedExecute](
    statement: MongoPreparedInternals,
    params: unknown,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeStatementStats>;
}

function hasBridge(
  target: MongoQueryExecutor,
  symbol: typeof mongoPreparedQuery | typeof mongoPreparedExecute,
): target is MongoQueryExecutor & MongoPreparedBridge {
  return symbol in target;
}

class MongoPreparedStatementImpl<Params, Row>
  implements MongoPreparedStatement<Params, Row>, MongoPreparedInternals
{
  readonly meta: PlanMeta;
  readonly draft: MongoLoweredDraft;
  readonly placeholders: ReadonlyArray<MongoPreparedParamRef>;
  readonly resultShape: MongoResultShape | undefined;

  constructor(internals: MongoPreparedInternals) {
    this.meta = internals.meta;
    this.draft = internals.draft;
    this.placeholders = internals.placeholders;
    this.resultShape = internals.resultShape;
    Object.freeze(this);
  }

  query(
    target: MongoQueryExecutor,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    invariant(
      hasBridge(target, mongoPreparedQuery),
      'A prepared statement runs against a MongoRuntime, such as `await db.runtime()`. The target passed to query() is not one: it has no prepared statement query bridge.',
    );
    return target[mongoPreparedQuery]<Row>(this, params, options);
  }
}

class MongoPreparedExecutionImpl<Params, Row>
  extends MongoPreparedStatementImpl<Params, Row>
  implements MongoPreparedExecution<Params, Row>
{
  execute(
    target: MongoQueryExecutor,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeStatementStats> {
    invariant(
      hasBridge(target, mongoPreparedExecute),
      'A prepared statement runs against a MongoRuntime, such as `await db.runtime()`. The target passed to execute() is not one: it has no prepared statement execute bridge.',
    );
    return target[mongoPreparedExecute](this, params, options);
  }
}

/** Builds the handle for a prepared draft: one with `execute` for the commands that report statement statistics, one with `query` only for the rest. */
export function createPreparedHandle<Params, Row>(
  internals: MongoPreparedInternals,
): MongoPreparedStatement<Params, Row> | MongoPreparedExecution<Params, Row> {
  return statisticsCountField(internals.draft.kind) !== undefined
    ? new MongoPreparedExecutionImpl<Params, Row>(internals)
    : new MongoPreparedStatementImpl<Params, Row>(internals);
}
