import type { PlanMeta } from '@internal/contract/types';
import type { ResultType } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { InsertOneCommand } from '../src/commands';
import type { MongoQueryPlan } from '../src/query-plan';

const meta: PlanMeta = {
  target: 'mongodb',
  storageHash: 'test',
  lane: 'mongo',
};

test('Row type is recoverable via framework ResultType', () => {
  const plan: MongoQueryPlan<{ _id: string; status: string }> = {
    collection: 'orders',
    command: new InsertOneCommand('orders', { _id: 'abc', status: 'open' }),
    meta,
  };
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toEqualTypeOf<{ _id: string; status: string }>();
});
