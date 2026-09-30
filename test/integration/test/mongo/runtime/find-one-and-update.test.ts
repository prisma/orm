import { FindOneAndUpdateCommand, MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('findOneAndUpdate integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'find_update_test';

  it('updates and returns the modified document', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertOne({ name: 'Grace', age: 30 });

      const command = new FindOneAndUpdateCommand(
        collectionName,
        MongoFieldFilter.eq('name', new MongoParamRef('Grace')),
        { $set: { age: 31 } },
        false,
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Grace', age: 31 });
    });
  });

  it('upserts when document does not exist', async () => {
    await withMongod(async (ctx) => {
      const command = new FindOneAndUpdateCommand(
        collectionName,
        MongoFieldFilter.eq('name', new MongoParamRef('NewUser')),
        { $set: { age: 20 } },
        true,
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'NewUser', age: 20 });
    });
  });
});
