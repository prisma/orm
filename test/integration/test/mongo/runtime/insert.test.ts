import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('insertOne integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'insert_test_users';

  it('inserts a document and returns insertedId', async () => {
    await withMongod(async (ctx) => {
      const command = new InsertOneCommand(collectionName, {
        name: new MongoParamRef('Dave'),
        age: new MongoParamRef(28),
      });
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('insertedId');

      const db = ctx.client.db(ctx.dbName);
      const docs = await db.collection(collectionName).find({}).toArray();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ name: 'Dave', age: 28 });
    });
  });
});
