import { runInNewContext } from 'node:vm';
import { int4Column, timestamptzJsDateColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    createdAt: field.column(timestamptzJsDateColumn).column('created_at'),
  },
}).sql({ table: 'realm_posts' });

const contract = defineContract({ models: { Post } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

describe('a Date created in another realm', () => {
  it(
    'is written and filtered through pg/timestamptz-date@1',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        const createdAt: Date = runInNewContext('new Date("2026-01-02T03:04:05.123Z")');
        const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });

        await posts.create({ id: 1, createdAt });
        const rows = await posts
          .where((p) => p['createdAt']!.eq(createdAt))
          .select('id', 'createdAt')
          .all();

        expect(rows).toEqual([{ id: 1, createdAt: new Date('2026-01-02T03:04:05.123Z') }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
