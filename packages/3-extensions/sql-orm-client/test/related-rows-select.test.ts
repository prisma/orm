import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { ParamRef } from '@internal/sql-relational-core/ast';
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
      `"SELECT "users"."id" AS "__prisma_parent_key_0", "posts"."id" AS "id", "posts"."title" AS "title" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" WHERE "posts"."views" > $1 ORDER BY "users"."id" ASC, "posts"."id" ASC"`,
    );
  });

  it("orders by parent, then the caller's order, then the child identity", () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts.select('title').orderBy((post) => post.views.desc()),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_key_0", "posts"."title" AS "title" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" ORDER BY "users"."id" ASC, "posts"."views" DESC, "posts"."id" ASC"`,
    );
  });

  it('joins a to-one parent that holds the foreign key', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection.include('author', (author) => author.select('name')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "posts"."id" AS "__prisma_parent_key_0", "users"."name" AS "name" FROM "public"."users" INNER JOIN "public"."posts" ON "users"."id" = "posts"."user_id" ORDER BY "posts"."id" ASC, "users"."id" ASC"`,
    );
  });

  it('gives the child of a self-relation its own alias', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('invitedUsers', (invited) => invited.select('id')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_key_0", "users_2"."id" AS "id" FROM "public"."users" AS "users_2" INNER JOIN "public"."users" ON "users_2"."invited_by_id" = "users"."id" ORDER BY "users"."id" ASC, "users_2"."id" ASC"`,
    );
  });

  it('pages each parent with a row number window over the child rows', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts
        .select('title')
        .orderBy((post) => post.views.desc())
        .offset(1)
        .limit(2),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "posts__rows__page"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows__page"."title" AS "title", "posts__rows__page"."__prisma_page_rn" AS "__prisma_page_rn" FROM (SELECT "posts__rows"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "posts__rows"."__prisma_parent_key_0" ORDER BY "posts__rows"."posts__order_0" ASC, "posts__rows"."posts__order_1" DESC, "posts__rows"."posts__order_2" ASC) AS "__prisma_page_rn" FROM (SELECT "users"."id" AS "__prisma_parent_key_0", "posts"."title" AS "title", "users"."id" AS "posts__order_0", "posts"."views" AS "posts__order_1", "posts"."id" AS "posts__order_2" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id") AS "posts__rows") AS "posts__rows__page" WHERE ("posts__rows__page"."__prisma_page_rn" > 1 AND "posts__rows__page"."__prisma_page_rn" <= 3) ORDER BY "posts__rows__page"."__prisma_parent_key_0" ASC, "posts__rows__page"."__prisma_page_rn" ASC"`,
    );
  });

  it('pages with a second window when the limit is an expression', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) => posts.select('title').offset(1)).state;
    const [include] = state.includes;
    if (include === undefined) throw new Error('the state has no include');
    const withParamLimit = {
      ...state,
      includes: [
        {
          ...include,
          nested: { ...include.nested, limit: ParamRef.of(2, { codec: { codecId: 'pg/int4@1' } }) },
        },
      ],
    };

    expect(sqlOfFirstInclude(withParamLimit)).toMatchInlineSnapshot(
      `"SELECT "posts__rows__limit"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows__limit"."title" AS "title", "posts__rows__limit"."__prisma_page_rn" AS "__prisma_page_rn" FROM (SELECT "posts__rows__page"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows__page"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "posts__rows__page"."__prisma_parent_key_0" ORDER BY "posts__rows__page"."__prisma_page_rn" ASC) AS "__prisma_page_rn" FROM (SELECT "posts__rows"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "posts__rows"."__prisma_parent_key_0" ORDER BY "posts__rows"."posts__order_0" ASC, "posts__rows"."posts__order_1" ASC) AS "__prisma_page_rn" FROM (SELECT "users"."id" AS "__prisma_parent_key_0", "posts"."title" AS "title", "users"."id" AS "posts__order_0", "posts"."id" AS "posts__order_1" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id") AS "posts__rows") AS "posts__rows__page" WHERE "posts__rows__page"."__prisma_page_rn" > 1) AS "posts__rows__limit" WHERE "posts__rows__limit"."__prisma_page_rn" <= $1 ORDER BY "posts__rows__limit"."__prisma_parent_key_0" ASC, "posts__rows__limit"."__prisma_page_rn" ASC"`,
    );
  });

  it('keeps the first row of each distinct group of each parent', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts.select('title').distinct('title').limit(1),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "posts__rows__page"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows__page"."title" AS "title", "posts__rows__page"."__prisma_page_rn" AS "__prisma_page_rn" FROM (SELECT "posts__rows"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "posts__rows"."__prisma_parent_key_0" ORDER BY "posts__rows"."posts__order_0" ASC, "posts__rows"."posts__order_1" ASC) AS "__prisma_page_rn" FROM (SELECT "posts__distinct"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__distinct"."title" AS "title", "posts__distinct"."posts__order_0" AS "posts__order_0", "posts__distinct"."posts__order_1" AS "posts__order_1" FROM (SELECT "users"."id" AS "__prisma_parent_key_0", "posts"."title" AS "title", "users"."id" AS "posts__order_0", "posts"."id" AS "posts__order_1", ROW_NUMBER() OVER (PARTITION BY "users"."id", "posts"."title" ORDER BY "users"."id" ASC, "posts"."id" ASC) AS "__prisma_distinct_rn" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id") AS "posts__distinct" WHERE "posts__distinct"."__prisma_distinct_rn" = 1) AS "posts__rows") AS "posts__rows__page" WHERE "posts__rows__page"."__prisma_page_rn" <= 1 ORDER BY "posts__rows__page"."__prisma_parent_key_0" ASC, "posts__rows__page"."__prisma_page_rn" ASC"`,
    );
  });

  it('puts the parent identity first in distinctOn', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) =>
      posts
        .select('title')
        .orderBy((post) => post.title.asc())
        .distinctOn('title'),
    ).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT DISTINCT ON ("users"."id", "posts"."title") "users"."id" AS "__prisma_parent_key_0", "posts"."title" AS "title" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" ORDER BY "users"."id" ASC, "posts"."title" ASC, "posts"."id" ASC"`,
    );
  });

  it('joins the parent through the junction table of a many-to-many relation', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('tags', (tags) => tags.select('name')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_key_0", "tags"."name" AS "name" FROM "public"."tags" INNER JOIN "public"."user_tags" ON "user_tags"."tag_id" = "tags"."id" INNER JOIN "public"."users" ON "user_tags"."user_id" = "users"."id" ORDER BY "users"."id" ASC, "tags"."id" ASC"`,
    );
  });

  it('returns every column of a composite parent identity', () => {
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related', (related) => related.select('name')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "projects"."tenant_id" AS "__prisma_parent_key_0", "projects"."id" AS "__prisma_parent_key_1", "projects_2"."name" AS "name" FROM "public"."projects" AS "projects_2" INNER JOIN "public"."project_links" ON ("project_links"."dst_tenant_id" = "projects_2"."tenant_id" AND "project_links"."dst_id" = "projects_2"."id") INNER JOIN "public"."projects" ON ("project_links"."src_tenant_id" = "projects"."tenant_id" AND "project_links"."src_id" = "projects"."id") ORDER BY "projects"."tenant_id" ASC, "projects"."id" ASC, "projects_2"."tenant_id" ASC, "projects_2"."id" ASC"`,
    );
  });

  it('groups a scalar include by the parent identity', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) => posts.sum('views')).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "__prisma_parent_key_0", SUM("posts"."views") AS "__prisma_aggregate" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id" GROUP BY "users"."id""`,
    );
  });

  it('pages the rows a scalar include aggregates before grouping them', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.include('posts', (posts) => posts.limit(2).count()).state;

    expect(sqlOfFirstInclude(state)).toMatchInlineSnapshot(
      `"SELECT "posts__scalar"."__prisma_parent_key_0" AS "__prisma_parent_key_0", COUNT(*) AS "__prisma_aggregate" FROM (SELECT "posts__rows__page"."__prisma_parent_key_0" AS "__prisma_parent_key_0", "posts__rows__page"."__prisma_page_rn" AS "__prisma_page_rn" FROM (SELECT "posts__rows"."__prisma_parent_key_0" AS "__prisma_parent_key_0", ROW_NUMBER() OVER (PARTITION BY "posts__rows"."__prisma_parent_key_0" ORDER BY "posts__rows"."posts__order_0" ASC, "posts__rows"."posts__order_1" ASC) AS "__prisma_page_rn" FROM (SELECT "users"."id" AS "__prisma_parent_key_0", "users"."id" AS "posts__order_0", "posts"."id" AS "posts__order_1" FROM "public"."posts" INNER JOIN "public"."users" ON "posts"."user_id" = "users"."id") AS "posts__rows") AS "posts__rows__page" WHERE "posts__rows__page"."__prisma_page_rn" <= 2) AS "posts__scalar" GROUP BY "posts__scalar"."__prisma_parent_key_0""`,
    );
  });
});
