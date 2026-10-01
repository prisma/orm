import { DeleteManyCommand, MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('deleteMany integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'delete_many_test';

  it('deletes multiple documents and returns count', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db
        .collection(collectionName)
        .insertMany([{ status: 'old' }, { status: 'old' }, { status: 'new' }]);

      const command = new DeleteManyCommand(
        collectionName,
        MongoFieldFilter.eq('status', new MongoParamRef('old')),
      );
      const rows = await ctx.runtime.query({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deletedCount: 2 });
    });
  });
});
