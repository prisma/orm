import { Collection } from '@internal/sql-orm-client';
import type { SelectAst } from '@internal/sql-relational-core/ast';
import {
  ColumnRef,
  type DerivedTableSource,
  type JsonArrayAggExpr,
  OrderByItem,
  type SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { getTestContext, getTestContract, isSelectAst } from './helpers';
import { type createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { ONE_QUERY_INCLUDE_CAPABILITIES } from './nested-includes-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(
    typeof source === 'object' &&
      source !== null &&
      'kind' in source &&
      source.kind === 'derived-table-source',
  ).toBe(true);
}

function expectSubqueryExpr(expr: unknown): asserts expr is SubqueryExpr {
  expect(
    typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'subquery',
  ).toBe(true);
}

function expectJsonArrayAggExpr(expr: unknown): asserts expr is JsonArrayAggExpr {
  expect(
    typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'json-array-agg',
  ).toBe(true);
}

function createUsersCollectionWithCapabilities(
  runtime: Parameters<typeof createUsersCollection>[0],
  capabilities: Record<string, unknown>,
) {
  const base = getTestContract();
  // Replace capabilities entirely (rather than merging with base) so the
  // test's intent is unambiguous. Merging with the base contract's
  // postgres namespace would leak `postgres.lateral` and `postgres.jsonAgg`
  // into the advertised capabilities — making it impossible to assert
  // behaviour against a contract that does not advertise `lateral`.
  const contract = {
    ...base,
    capabilities,
  } as typeof base;

  const context = { ...getTestContext(), contract };
  return new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
}

// One-query include SQL shapes: these assert the correlated subqueries the one-query
// include emits, so they run with capabilities that select it.
describe('integration/include, one-query include', () => {
  it(
    'a lateral-capable contract still lowers an include to a correlated subquery',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        // The `lateral` capability flag is inert for include codegen:
        // every include lowers to a correlated subquery regardless.
        const users = createUsersCollectionWithCapabilities(runtime, {
          sql: ONE_QUERY_INCLUDE_CAPABILITIES,
          postgres: { jsonAgg: true, lateral: true },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .offset(1)
              .limit(1),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 11, title: 'Post B', userId: 1, views: 200, embedding: null }],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);

        const execution = runtime.executions[0];
        const ast = execution?.ast;
        expectSelectAst(ast);
        // No lateral join is emitted for the include.
        expect((ast.joins ?? []).some((join) => join.lateral)).toBe(false);
        expect(execution?.sql).not.toContain('LATERAL');

        const postsProjection = ast.projection.find((item) => item.alias === 'posts');
        expectSubqueryExpr(postsProjection?.expr);
        const includeAggregateProjection = postsProjection.expr.query.projection[0];
        expectJsonArrayAggExpr(includeAggregateProjection?.expr);
        expect(includeAggregateProjection.expr.onEmpty).toBe('emptyArray');
        expect(includeAggregateProjection.expr.expr.value.kind).toBe('json-object');
        expect(includeAggregateProjection.expr.orderBy).toEqual([
          OrderByItem.asc(ColumnRef.of('posts__rows', 'posts__order_0')),
        ]);

        const rowsSource = postsProjection.expr.query.from;
        expectDerivedTableSource(rowsSource);
        expect(rowsSource.query.limit).toBe(1);
        expect(rowsSource.query.offset).toBe(1);
        expect(rowsSource.query.projection.map((item) => item.alias)).toContain('posts__order_0');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a lateral-capable contract correlates self-relations with child alias',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          sql: ONE_QUERY_INCLUDE_CAPABILITIES,
          postgres: { jsonAgg: true, lateral: true },
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [
              { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
            ],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            address: null,
            invitedUsers: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
        const ast = runtime.executions[0]?.ast;
        expectSelectAst(ast);
        // No lateral join is emitted for the include.
        expect((ast.joins ?? []).some((join) => join.lateral)).toBe(false);

        const invitedUsersProjection = ast.projection.find((item) => item.alias === 'invitedUsers');
        expectSubqueryExpr(invitedUsersProjection?.expr);
        const includeAggregateProjection = invitedUsersProjection.expr.query.projection[0];
        expectJsonArrayAggExpr(includeAggregateProjection?.expr);
        expect(includeAggregateProjection.expr.orderBy).toEqual([
          OrderByItem.asc(ColumnRef.of('invitedUsers__rows', 'invitedUsers__order_0')),
        ]);

        const rowsSource = invitedUsersProjection.expr.query.from;
        expectDerivedTableSource(rowsSource);
        expect(rowsSource.query.projection.map((item) => item.alias)).toContain(
          'invitedUsers__order_0',
        );

        const sql = runtime.executions[0]?.sql;
        expect(sql).not.toContain('LATERAL');
        expect(sql).toContain('"users_2"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query include uses correlated strategy when lateral is not enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          // jsonAgg without lateral → correlated subquery strategy.
          sql: ONE_QUERY_INCLUDE_CAPABILITIES,
        });

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 100 }]);

        runtime.resetExecutions();
        const rows = await users.include('posts').all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 10, title: 'Post A', userId: 1, views: 100, embedding: null }],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);

        const ast = runtime.executions[0]?.ast;
        expectSelectAst(ast);
        expect(ast.joins ?? []).toHaveLength(0);

        const postsProjection = ast.projection.find((item) => item.alias === 'posts');
        expectSubqueryExpr(postsProjection?.expr);
        const includeAggregateProjection = postsProjection.expr.query.projection[0];
        expectJsonArrayAggExpr(includeAggregateProjection?.expr);
        expect(includeAggregateProjection.expr.onEmpty).toBe('emptyArray');
        expect(includeAggregateProjection.expr.expr.value.kind).toBe('json-object');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query correlated include correlates self-relations with child alias',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          // jsonAgg without lateral → correlated subquery strategy.
          sql: ONE_QUERY_INCLUDE_CAPABILITIES,
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [
              { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
            ],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            address: null,
            invitedUsers: [],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
        const ast = runtime.executions[0]?.ast;
        expectSelectAst(ast);

        const invitedUsersProjection = ast.projection.find((item) => item.alias === 'invitedUsers');
        expectSubqueryExpr(invitedUsersProjection?.expr);
        const includeAggregateProjection = invitedUsersProjection.expr.query.projection[0];
        expectJsonArrayAggExpr(includeAggregateProjection?.expr);
        expect(includeAggregateProjection.expr.orderBy).toEqual([
          OrderByItem.asc(ColumnRef.of('invitedUsers__rows', 'invitedUsers__order_0')),
        ]);

        const rowsSource = invitedUsersProjection.expr.query.from;
        expectDerivedTableSource(rowsSource);
        expect(rowsSource.query.projection.map((item) => item.alias)).toContain(
          'invitedUsers__order_0',
        );

        const sql = runtime.executions[0]?.sql;
        expect(sql).toContain('"users_2"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'depth-2 include uses correlated subqueries when lateral is not enabled',
    async () => {
      // No lateral. Same acceptance criterion as the case
      // above: one round-trip, regardless of depth or row count, when
      // the target advertises the capability.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          sql: ONE_QUERY_INCLUDE_CAPABILITIES,
        });

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
          { id: 102, body: 'Comment C', postId: 11 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .include('comments', (comments) => comments.orderBy((c) => c.id.asc())),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [
              {
                id: 10,
                title: 'Post A',
                userId: 1,
                views: 100,
                embedding: null,
                comments: [
                  { id: 100, body: 'Comment A', postId: 10 },
                  { id: 101, body: 'Comment B', postId: 10 },
                ],
              },
              {
                id: 11,
                title: 'Post B',
                userId: 1,
                views: 200,
                embedding: null,
                comments: [{ id: 102, body: 'Comment C', postId: 11 }],
              },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [
              {
                id: 12,
                title: 'Post C',
                userId: 2,
                views: 300,
                embedding: null,
                comments: [],
              },
            ],
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
