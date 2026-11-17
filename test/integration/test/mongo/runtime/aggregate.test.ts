import {
  AggregateCommand,
  MongoAggAccumulator,
  MongoAggFieldRef,
  MongoFieldFilter,
  MongoGroupStage,
  MongoMatchStage,
  MongoSortStage,
} from '@internal/mongo-query-ast/execution';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('aggregate integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'aggregate_test_orders';

  it('runs a typed $group aggregation pipeline', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { department: 'eng', amount: 100 },
        { department: 'eng', amount: 200 },
        { department: 'sales', amount: 150 },
      ]);

      const command = new AggregateCommand(collectionName, [
        new MongoMatchStage(MongoFieldFilter.of('amount', '$gte', 100)),
        new MongoGroupStage(MongoAggFieldRef.of('department'), {
          total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
        }),
        new MongoSortStage({ _id: 1 }),
      ]);
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number }>;
      expect(typed[0]).toMatchObject({ _id: 'eng', total: 300 });
      expect(typed[1]).toMatchObject({ _id: 'sales', total: 150 });
    });
  });
});
