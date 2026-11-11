import type { AsyncIterableResult, QueryPlan } from '@internal/framework-components/runtime';
import type { AnyMongoCommand } from './commands';
import type { MongoResultShape } from './result-shape';

declare const __mongoQueryPlanRow: unique symbol;

/**
 * Mongo-domain query plan produced by lanes before lowering.
 *
 * Extends the framework-level `QueryPlan<Row>` marker (`meta + _row`) and
 * adds Mongo-specific fields (`collection`, `command`). The unique-symbol
 * phantom is retained alongside the inherited `_row` for backwards
 * compatibility with anything that may have relied on it.
 */
export interface MongoQueryPlan<Row = unknown, Command extends AnyMongoCommand = AnyMongoCommand>
  extends QueryPlan<Row> {
  readonly collection: string;
  readonly command: Command;
  readonly resultShape?: MongoResultShape;
  readonly [__mongoQueryPlanRow]?: Row;
}

/** A read that `prepare` can take: the plan it sends, and how each run's rows become its result. */
export interface MongoPreparable<Row, Result> {
  readonly plan: MongoQueryPlan<Row>;
  consume(rows: AsyncIterableResult<Row>): Result;
}
