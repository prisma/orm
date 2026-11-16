import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/postgres/2-adapter/src/core/types';
import { deriveParamsFromAst } from '../src/query-plan-meta';
import { relatedRowsSelect } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { getTestAggregates } from './helpers';

const adapter = createPostgresAdapter();

function sqlOfFirstInclude(state: CollectionState): string {
  const [include] = state.includes;
  if (include === undefined) throw new Error('the state has no include');
  const { ast } = relatedRowsSelect(baseContract, getTestAggregates(), state.tables, include);
  return adapter.lower(ast, {
    contract: blindCast<PostgresContract, 'the test contract targets postgres'>(baseContract),
    params: deriveParamsFromAst(ast).params,
  }).sql;
}

describe('the statement that reads an include per relation', () => {
  it('joins a to-many child to its parent and returns the parent identity', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts.select('id', 'title').where((post) => post.views.gt(10)),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_0", "posts"."id" AS "id", "posts"."title" AS "title" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" WHERE "posts"."views" > $1 ORDER BY "users"."id" ASC, "posts"."id" ASC"`,
    );
  });

  it("orders by parent, then the caller's order, then the child identity", () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts.select('title').orderBy((post) => post.views.desc()),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_0", "posts"."title" AS "title" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" ORDER BY "users"."id" ASC, "posts"."views" DESC, "posts"."id" ASC"`,
    );
  });

  it('joins a to-one parent that holds the foreign key', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection.include('author', (author) => author.select('name')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "posts"."id" AS "__prisma_parent_0", "users"."name" AS "name" FROM "public"."users" INNER JOIN "public"."posts" ON "users"."id" = "posts"."user_id" ORDER BY "posts"."id" ASC, "users"."id" ASC"`,
    );
  });

  it('gives the child of a self-relation its own alias', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('invitedUsers', (invited) => invited.select('id')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_0", "users_2"."id" AS "id" FROM "public"."users" AS "users_2" INNER JOIN "public"."users" ON "users_2"."invited_by_id" = "users"."id" ORDER BY "users"."id" ASC, "users_2"."id" ASC"`,
    );
  });

  it('is not built yet for paged and distinct includes', () => {
    const { collection } = createCollectionFor('User');
    const states = {
      'limit()': collection.include('posts', (posts) => posts.limit(1)).state,
      'offset()': collection.include('posts', (posts) => posts.offset(1)).state,
      'distinct()': collection.include('posts', (posts) => posts.distinct('title')).state,
    };

    for (const [form, state] of Object.entries(states)) {
      expect(() => sqlOfFirstInclude(state)).toThrow(`not built yet for ${form}`);
    }
  });
});
