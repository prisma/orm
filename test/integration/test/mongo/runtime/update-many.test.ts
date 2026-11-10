import { MongoFieldFilter, UpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('updateMany integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'update_many_test';

  it('updates multiple documents and returns counts', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { status: 'active', name: 'A' },
        { status: 'active', name: 'B' },
        { status: 'inactive', name: 'C' },
      ]);

      const command = new UpdateManyCommand(
        collectionName,
        MongoFieldFilter.eq('status', new MongoParamRef('active')),
        { $set: { status: new MongoParamRef('archived') } },
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    });
  });
});
