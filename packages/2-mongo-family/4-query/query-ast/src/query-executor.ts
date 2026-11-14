import type {
  AsyncIterableResult,
  RuntimeStatementStats,
} from '@internal/framework-components/runtime';
import type { MongoQueryPlan } from './query-plan';

export interface MongoQueryExecutor {
  query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  execute(plan: MongoQueryPlan): Promise<RuntimeStatementStats>;
}
