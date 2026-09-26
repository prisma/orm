import { DeleteOneCommand, MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('deleteOne integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'delete_test_users';

  it('deletes a matching document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      const command = new DeleteOneCommand(
        collectionName,
        MongoFieldFilter.eq('name', new MongoParamRef('Bob')),
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deletedCount: 1 });

      const remaining = await db.collection(collectionName).find({}).toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'Alice' });
    });
  });
});
