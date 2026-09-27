import { FindOneAndDeleteCommand, MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('findOneAndDelete integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'find_delete_test';

  it('deletes and returns the removed document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertOne({ name: 'Ivan', age: 40 });

      const command = new FindOneAndDeleteCommand(
        collectionName,
        MongoFieldFilter.eq('name', new MongoParamRef('Ivan')),
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Ivan', age: 40 });

      const remaining = await db.collection(collectionName).find({}).toArray();
      expect(remaining).toHaveLength(0);
    });
  });
});
