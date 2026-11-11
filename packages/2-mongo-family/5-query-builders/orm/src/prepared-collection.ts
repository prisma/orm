import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoPreparable } from '@internal/mongo-query-ast/execution';

/** The reads of a collection that `prepare` can take. Each describes the plan and how its rows become the result, and sends nothing. */
export interface MongoPreparedCollection<Row> {
  all(): MongoPreparable<Record<string, unknown>, AsyncIterableResult<Row>>;
  /** Reads with `limit` set to 1, replacing any `limit` placeholder. */
  first(): MongoPreparable<Record<string, unknown>, Promise<Row | null>>;
}
