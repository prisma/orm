import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

function wideContract(wideColumns: readonly string[]) {
  const Comment = model('Comment', {
    fields: {
      id: field.column(int4Column).id(),
      postId: field.column(int4Column).column('post_id'),
      ...Object.fromEntries(wideColumns.map((name) => [name, field.column(textColumn)])),
    },
  }).sql({ table: 'wide_comments' });

  const Post = model('Post', {
    fields: { id: field.column(int4Column).id() },
    relations: { comments: rel.hasMany(() => Comment, { by: 'postId' }) },
  }).sql({ table: 'wide_posts' });

  return defineContract({ models: { Post, Comment } });
}

describe('a to-many include of a model with more than 50 columns', () => {
  it.each([51, 120])(
    'returns every column of the related rows in field order, for %i columns',
    async (columnCount) => {
      const wideColumns = Array.from(
        { length: columnCount - 2 },
        (_, index) => `c${columnCount - 2 - index}`,
      );
      const contract = wideContract(wideColumns);
      const context = createExecutionContext({
        contract,
        stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
      });

      await withPushedContractRuntime(contract, async (runtime) => {
        await runtime.query(`
          insert into wide_posts (id) values (1);
          insert into wide_comments (id, post_id, ${wideColumns.join(', ')})
            values (1, 1, ${wideColumns.map((name) => `'${name}'`).join(', ')});
        `);
        const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });

        const rows = await posts.include('comments').all();

        const comment = {
          id: 1,
          postId: 1,
          ...Object.fromEntries(wideColumns.map((name) => [name, name])),
        };
        expect(rows).toEqual([{ id: 1, comments: [comment] }]);
        expect(Object.keys(rows[0]?.comments[0] ?? {})).toEqual(Object.keys(comment));
      });
    },
    timeouts.spinUpPpgDev,
  );
});
