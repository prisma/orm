import {
  AggregateCommand,
  MongoFieldFilter,
  MongoMatchStage,
} from '@internal/mongo-query-ast/execution';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

describe('execute (read plan)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const collectionName = 'read_plan_test';

  it('executes a read plan and returns matching rows', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection(collectionName).insertMany([
        { name: 'Alice', role: 'admin' },
        { name: 'Bob', role: 'user' },
        { name: 'Carol', role: 'admin' },
      ]);

      const command = new AggregateCommand(collectionName, [
        new MongoMatchStage(MongoFieldFilter.eq('role', 'admin')),
      ]);
      const rows = await ctx.runtime.query<{ name: string; role: string }>({
        collection: collectionName,
        command,
        meta: ctx.stubMeta,
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
    });
  });
});
