import type { PlanMeta } from '@internal/contract/types';
import type { ExecutionPlan, QueryPlan, ResultType } from '@internal/framework-components/runtime';
import { InsertOneWireCommand } from '@internal/mongo-wire';
import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';

const meta: PlanMeta = {
  target: 'mongodb',
  storageHash: 'test',
  lane: 'mongo',
};

test('MongoExecutionPlan extends framework ExecutionPlan and QueryPlan', () => {
  const plan: MongoExecutionPlan<{ _id: string }> = {
    command: new InsertOneWireCommand('orders', { _id: 'abc' }),
    meta,
  };
  assertType<ExecutionPlan<{ _id: string }>>(plan);
  assertType<QueryPlan<{ _id: string }>>(plan);
});

test('Row type is recoverable via ResultType', () => {
  const plan: MongoExecutionPlan<{ _id: string; total: number }> = {
    command: new InsertOneWireCommand('orders', { _id: 'abc', total: 12 }),
    meta,
  };
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toEqualTypeOf<{ _id: string; total: number }>();
});

test('Plan without a wire command does not satisfy MongoExecutionPlan', () => {
  // @ts-expect-error - missing command property
  const _bad: MongoExecutionPlan = { meta };
});
