import { InsertManyCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('insertMany integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'insert_many_test';

  it('inserts multiple documents and returns insertedIds', async () => {
    await withMongod(async (ctx) => {
      const command = new InsertManyCommand(collectionName, [
        { name: new MongoParamRef('Alice'), age: 30 },
        { name: new MongoParamRef('Bob'), age: 25 },
      ]);
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ insertedCount: 2 });
      expect((rows[0] as { insertedIds: unknown[] }).insertedIds).toHaveLength(2);

      const db = ctx.client.db(ctx.dbName);
      const docs = await db.collection(collectionName).find({}).toArray();
      expect(docs).toHaveLength(2);
    });
  });
});
