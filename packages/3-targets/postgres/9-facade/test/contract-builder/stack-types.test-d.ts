import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model, rel } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;

const Post = model('Post', {
  fields: { id: field.column(int4).id(), title: field.column(text), authorId: field.column(int4) },
});

const contract = defineContract({
  models: {
    User: model('User', {
      fields: { id: field.column(int4).id(), name: field.column(text), score: field.column(int4) },
    })
      .relations({ posts: rel.hasMany(Post, { by: 'authorId' }) })
      .sql({ table: 'users' }),
    Post: Post.sql({ table: 'posts' }),
  },
});

const db = postgres({ contract, url: 'postgres://localhost/db' });

test('the codec types are the target codec types', () => {
  expectTypeOf<ExtractCodecTypes<typeof contract>['pg/int4@1']['output']>().toEqualTypeOf<number>();
  expectTypeOf<ExtractCodecTypes<typeof contract>['pg/text@1']['input']>().toEqualTypeOf<string>();
});

test('aggregates have the target result types', async () => {
  const totals = await db.orm.public.User.aggregate((aggregate) => ({
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
  const user = await db.orm.public.User.select('id')
    .include('posts', (posts) => posts.count())
    .first();
  expectTypeOf(user).toEqualTypeOf<{ id: number; posts: number } | null>();
});

test('a field has the target query operations', () => {
  db.orm.public.User.where((user) => user.name.ilike('%a%'));
});

test('the adapter capabilities enable distinctOn and row locks', () => {
  db.orm.public.User.orderBy((user) => user.name.asc()).distinctOn('name');
  db.orm.public.User.forUpdate();
  db.orm.public.User.forNoKeyUpdate();
});

const bitwise = {
  kind: 'extension',
  id: 'bitwise',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  types: {
    aggregateDescriptors: [
      {
        operation: 'bitOr',
        input: { kind: 'codec', codecId: 'pg/int4@1' },
        output: { kind: 'codec', codecId: 'pg/int8@1' },
        nullable: true,
      },
      {
        operation: 'longest',
        input: { kind: 'trait', trait: 'textual' },
        output: { kind: 'self' },
        nullable: true,
      },
    ],
  },
} as const;

test('an extension contributes aggregates, settled against the contract codecs as emission settles them', async () => {
  const withExtension = defineContract({
    extensions: { bitwise },
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4).id(),
          name: field.column(text),
          score: field.column(int4),
        },
      }).sql({ table: 'users' }),
    },
  });
  const client = postgres({ contract: withExtension, url: 'postgres://localhost/db' });
  const totals = await client.orm.public.User.aggregate((aggregate) => ({
    bits: aggregate.bitOr('score'),
    longest: aggregate.longest('name'),
    users: aggregate.count(),
  }));
  expectTypeOf(totals).toEqualTypeOf<{
    bits: bigint | null;
    longest: string | null;
    users: number;
  }>();
});
