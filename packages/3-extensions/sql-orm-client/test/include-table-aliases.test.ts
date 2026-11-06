import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/postgres/2-adapter/src/core/types';
import { resolveIncludeRelation } from '../src/collection-contract';
import { type CollectionTables, createIncludeTables } from '../src/collection-tables';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import { createTableScope } from '../src/table-scope';
import { type CollectionState, emptyState, type IncludeExpr } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { buildMixedPolyContract, getTestAggregates } from './helpers';

const adapter = createPostgresAdapter();

const modelOfTable: Record<string, string> = { posts: 'Post', users: 'User' };

function sqlOf(state: CollectionState): string {
  const plan = compileSelectWithIncludes(
    baseContract,
    getTestAggregates(),
    modelOfTable[state.tables.root.storage.tableName]!,
    state,
  );
  return adapter.lower(plan.ast, {
    contract: blindCast<PostgresContract, 'the test contract targets postgres'>(baseContract),
    params: plan.params,
  }).sql;
}

describe('table aliases in includes', () => {
  it('gives a self-relation child its own alias, and its refinement filters use it', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('invitedUsers', (invited) =>
        invited.select('id').where((user) => user.name.eq('Bob')),
      ).state;

    const sql = sqlOf(state);
    expect(sql).toContain('FROM "public"."users" AS "users_2"');
    expect(sql).toContain('"users_2"."invited_by_id" = "users"."id"');
    expect(sql).toContain('"users_2"."name" = $1');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id")), json_build_array()) AS "invitedUsers" FROM (SELECT "users_2"."id" AS "id" FROM "public"."users" AS "users_2" WHERE ("users_2"."invited_by_id" = "users"."id" AND "users_2"."name" = $1)) AS "invitedUsers__rows") AS "invitedUsers" FROM "public"."users""`,
    );
  });

  it('aliases an include that returns to an ancestor table', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('posts', (posts) =>
        posts.select('id').include('author', (author) => author.select('name')),
      ).state;

    const sql = sqlOf(state);
    expect(sql).toContain('FROM "public"."users" AS "users_2"');
    expect(sql).toContain('"users_2"."id" = "posts"."user_id"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "posts__rows"."id", 'author', "posts__rows"."author")), json_build_array()) AS "posts" FROM (SELECT "posts"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('name', "author__rows"."name")), json_build_array()) AS "author" FROM (SELECT "users_2"."name" AS "name" FROM "public"."users" AS "users_2" WHERE "users_2"."id" = "posts"."user_id") AS "author__rows") AS "author" FROM "public"."posts" WHERE "posts"."user_id" = "users"."id") AS "posts__rows") AS "posts" FROM "public"."users""`,
    );
  });

  it('names an included table apart from an earlier relation filter over the same table', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .where((user) => user.posts.some((post) => post.views.gt(10)))
      .include('posts', (posts) => posts.select('id')).state;

    const sql = sqlOf(state);
    expect(sql).toContain('FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND');
    expect(sql).toContain('FROM "public"."posts" AS "posts_2" WHERE "posts_2"."user_id"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "posts__rows"."id")), json_build_array()) AS "posts" FROM (SELECT "posts_2"."id" AS "id" FROM "public"."posts" AS "posts_2" WHERE "posts_2"."user_id" = "users"."id") AS "posts__rows") AS "posts" FROM "public"."users" WHERE EXISTS (SELECT "posts"."user_id" AS "_exists" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND "posts"."views" > $1))"`,
    );
  });

  it('names a relation filter apart from an earlier include of the same table', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('posts', (posts) => posts.select('id'))
      .where((user) => user.posts.some((post) => post.views.gt(10))).state;

    const sql = sqlOf(state);
    expect(sql).toContain('FROM "public"."posts" WHERE "posts"."user_id" = "users"."id"');
    expect(sql).toContain('FROM "public"."posts" AS "posts_2" WHERE ("posts_2"."user_id"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "posts__rows"."id")), json_build_array()) AS "posts" FROM (SELECT "posts"."id" AS "id" FROM "public"."posts" WHERE "posts"."user_id" = "users"."id") AS "posts__rows") AS "posts" FROM "public"."users" WHERE EXISTS (SELECT "posts_2"."user_id" AS "_exists" FROM "public"."posts" AS "posts_2" WHERE ("posts_2"."user_id" = "users"."id" AND "posts_2"."views" > $1))"`,
    );
  });

  it('gives two sibling includes of one table distinct aliases', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('invitedUsers', (invited) => invited.select('id'))
      .include('invitedBy', (inviter) => inviter.select('id')).state;

    const sql = sqlOf(state);
    expect(sql).toContain('"users_2"."invited_by_id" = "users"."id"');
    expect(sql).toContain('"users_3"."id" = "users"."invited_by_id"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id")), json_build_array()) AS "invitedUsers" FROM (SELECT "users_2"."id" AS "id" FROM "public"."users" AS "users_2" WHERE "users_2"."invited_by_id" = "users"."id") AS "invitedUsers__rows") AS "invitedUsers", (SELECT coalesce(json_agg(json_build_object('id', "invitedBy__rows"."id")), json_build_array()) AS "invitedBy" FROM (SELECT "users_3"."id" AS "id" FROM "public"."users" AS "users_3" WHERE "users_3"."id" = "users"."invited_by_id") AS "invitedBy__rows") AS "invitedBy" FROM "public"."users""`,
    );
  });

  it('keeps a nested include name out of a later sibling include', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('posts', (posts) => posts.select('id').include('author', (a) => a.select('id')))
      .include('invitedUsers', (invited) => invited.select('id')).state;

    expect(sqlOf(state)).toContain('"users_3"."invited_by_id" = "users"."id"');
  });

  it('shares the child alias between combine branches', () => {
    const { collection } = createCollectionFor('User');
    const state = collection.select('id').include('invitedUsers', (invited) =>
      invited.combine({
        named: invited.select('id').where((user) => user.name.eq('Bob')),
        total: invited.count(),
      }),
    ).state;

    const sql = sqlOf(state);
    expect(sql.match(/FROM "public"\."users" AS "users_2"/g)).toHaveLength(2);
    expect(sql).not.toContain('"users_3"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT json_build_object('named', "invitedUsers__combine__named"."invitedUsers", 'total', "invitedUsers__combine__total"."invitedUsers") AS "invitedUsers" FROM (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id")), json_build_array()) AS "invitedUsers" FROM (SELECT "users_2"."id" AS "id" FROM "public"."users" AS "users_2" WHERE ("users_2"."invited_by_id" = "users"."id" AND "users_2"."name" = $1)) AS "invitedUsers__rows") AS "invitedUsers__combine__named" INNER JOIN (SELECT json_build_object('value', CAST(COUNT(*) AS text)) AS "invitedUsers" FROM "public"."users" AS "users_2" WHERE "users_2"."invited_by_id" = "users"."id") AS "invitedUsers__combine__total" ON TRUE) AS "invitedUsers" FROM "public"."users""`,
    );
  });

  it('lets a later sibling include reuse an alias used only inside a combine branch', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .select('id')
      .include('posts', (posts) =>
        posts.combine({
          byAuthor: posts.select('id').where((post) => post.author.some()),
          authored: posts.where((post) => post.author.some()).count(),
        }),
      )
      .include('invitedUsers', (invited) => invited.select('id')).state;

    const sql = sqlOf(state);
    expect(
      sql.match(/FROM "public"\."users" AS "users_2" WHERE "users_2"\."id" = "posts"\."user_id"/g),
    ).toHaveLength(2);
    expect(sql).toContain('"users_2"."invited_by_id" = "users"."id"');
    expect(sql).not.toContain('"users_3"');
    expect(sql).toMatchInlineSnapshot(
      `"SELECT "users"."id" AS "id", (SELECT json_build_object('byAuthor', "posts__combine__byAuthor"."posts", 'authored', "posts__combine__authored"."posts") AS "posts" FROM (SELECT coalesce(json_agg(json_build_object('id', "posts__rows"."id")), json_build_array()) AS "posts" FROM (SELECT "posts"."id" AS "id" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND EXISTS (SELECT "users_2"."id" AS "_exists" FROM "public"."users" AS "users_2" WHERE "users_2"."id" = "posts"."user_id"))) AS "posts__rows") AS "posts__combine__byAuthor" INNER JOIN (SELECT json_build_object('value', CAST(COUNT(*) AS text)) AS "posts" FROM "public"."posts" WHERE ("posts"."user_id" = "users"."id" AND EXISTS (SELECT "users_2"."id" AS "_exists" FROM "public"."users" AS "users_2" WHERE "users_2"."id" = "posts"."user_id"))) AS "posts__combine__authored" ON TRUE) AS "posts", (SELECT coalesce(json_agg(json_build_object('id', "invitedUsers__rows"."id")), json_build_array()) AS "invitedUsers" FROM (SELECT "users_2"."id" AS "id" FROM "public"."users" AS "users_2" WHERE "users_2"."invited_by_id" = "users"."id") AS "invitedUsers__rows") AS "invitedUsers" FROM "public"."users""`,
    );
  });

  it('finds the local variant table by variant identity when it shares a table name with the root', () => {
    const contract = buildMixedPolyContract();
    const scope = createTableScope();
    const sharedName = { namespaceId: 'public', tableName: 'tasks' };
    const tables: CollectionTables = {
      scope,
      root: scope.aliasTable(sharedName),
      variants: new Map([['feature', scope.aliasTable(sharedName)]]),
    };
    const relation = resolveIncludeRelation(contract, 'public', 'Task', 'assignee', 'feature');
    expect(relation.localVariantValue).toBe('feature');
    const child = createIncludeTables(contract, tables, relation);
    const assignee: IncludeExpr = {
      relationName: 'assignee',
      ...relation,
      nested: { ...emptyState(child.tables), selectedFields: ['id'] },
      scalar: undefined,
      combine: undefined,
    };

    const plan = compileSelectWithIncludes(contract, getTestAggregates(), 'Task', {
      ...emptyState(tables),
      selectedFields: ['id'],
      variantValue: 'feature',
      includes: [assignee],
    });
    const sql = adapter.lower(plan.ast, {
      contract: blindCast<PostgresContract, 'the test contract targets postgres'>(contract),
      params: plan.params,
    }).sql;

    expect(sql).toContain('"assignees"."id" = "tasks_2"."assignee_id"');
    expect(sql).not.toContain('"assignees"."id" = "tasks"."assignee_id"');
  });
});
