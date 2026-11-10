import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model, rel } from '../../src/exports/contract-builder';
import sqlite from '../../src/exports/runtime';

const integer = { codecId: 'sqlite/integer@1' } as const;
const text = { codecId: 'sqlite/text@1' } as const;

const Post = model('Post', {
  fields: {
    id: field.column(integer).id(),
    title: field.column(text),
    authorId: field.column(integer),
  },
});

const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(integer).id(),
        name: field.column(text),
        score: field.column(integer),
      },
    })
      .relations({ posts: rel.hasMany(Post, { by: 'authorId' }) })
      .sql({ table: 'users' }),
    Post: Post.sql({ table: 'posts' }),
  },
});

const db = sqlite({ contract, path: ':memory:', verifyMarker: false });

test('the codec types are the target codec types', () => {
  expectTypeOf<
    ExtractCodecTypes<typeof contract>['sqlite/integer@1']['output']
  >().toEqualTypeOf<number>();
});

test('aggregates have the target result types', async () => {
  const totals = await db.orm.User.aggregate((aggregate) => ({
    users: aggregate.count(),
    score: aggregate.sum('score'),
    lastName: aggregate.max('name'),
  }));
  expectTypeOf(totals).toEqualTypeOf<{
    users: number;
    score: number | null;
    lastName: string | null;
  }>();
});

test('an include refinement reduces with the target aggregates', async () => {
  const user = await db.orm.User.select('id')
    .include('posts', (posts) =>
      posts.combine({ total: posts.count(), sum: posts.sum('authorId') }),
    )
    .first();
  expectTypeOf(user).toEqualTypeOf<{
    id: number;
    posts: { total: number; sum: number | null };
  } | null>();
});
