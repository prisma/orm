import { MongoFieldFilter, UpdateOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('updateOne integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'update_test_users';

  it('updates a matching document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const command = new UpdateOneCommand(
        collectionName,
        MongoFieldFilter.eq('name', new MongoParamRef('Alice')),
        { $set: { age: new MongoParamRef(31) } },
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 });

      const doc = await db.collection(collectionName).findOne({ name: 'Alice' });
      expect(doc).toMatchObject({ name: 'Alice', age: 31 });
    });
  });
});
