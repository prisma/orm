import type {
  AsyncIterableResult,
  RuntimeStatementStats,
} from '@internal/framework-components/runtime';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { expectTypeOf, test } from 'vitest';
import type { MongoRuntime } from '../src/mongo-runtime';

test('MongoRuntime exposes row queries and statistics execution', () => {
  type Row = { readonly id: string };
  const runtime = {} as MongoRuntime;
  const plan = {} as MongoQueryPlan<Row>;

  expectTypeOf(runtime.query(plan)).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(runtime.execute(plan)).toEqualTypeOf<Promise<RuntimeStatementStats>>();
});
