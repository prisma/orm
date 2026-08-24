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
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedComments, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

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
  // behaviour against a contract that advertises only `jsonAgg`.
  const contract = {
    ...base,
    capabilities,
  } as typeof base;

  const context = { ...getTestContext(), contract };
  return new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
}

type NumericPostField = import('@internal/sql-orm-client').NumericFieldNames<
  ReturnType<typeof getTestContract>,
  'Post'
>;

describe('integration/include', () => {
  it(
    'depth-1 include against an emitted contract fires a single SQL execution (regression guard for namespaced capability lookup)',
    async () => {
      // Guards against regressing single-query include dispatch. The
      // default `getTestContract()` carries `postgres: { lateral: true,
      // jsonAgg: true, ... }` — the emitter's actual output shape. A
      // depth-1 include must resolve in one SQL execution, not two,
      // against a real driver.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

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
        // The point of the test: 1 execution, not N+1.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() stitches one-to-many and one-to-one relations from real rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Primary profile' }]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .include('profile')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [
              { id: 10, title: 'Post A', userId: 1, views: 100, embedding: null },
              { id: 11, title: 'Post B', userId: 1, views: 200, embedding: null },
            ],
            profile: { id: 100, userId: 1, bio: 'Primary profile' },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 12, title: 'Post C', userId: 2, views: 300, embedding: null }],
            profile: null,
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar count() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);
        await seedComments(runtime, [
          { id: 100, body: 'Comment A', postId: 10 },
          { id: 101, body: 'Comment B', postId: 10 },
          { id: 102, body: 'Comment C', postId: 12 },
        ]);

        runtime.resetExecutions();
        const rows = await posts
          .orderBy((post) => post.id.asc())
          .include('comments', (comments) => comments.count())
          .all();

        expect(rows).toEqual([
          { id: 10, title: 'Post A', userId: 1, views: 100, embedding: null, comments: 2 },
          { id: 11, title: 'Post B', userId: 1, views: 200, embedding: null, comments: 0 },
          { id: 12, title: 'Post C', userId: 2, views: 300, embedding: null, comments: 1 },
        ]);
        // Scalar `count()` lowers to a correlated subquery `(SELECT
        // json_build_object('value', count(*)) ...)` — the whole
        // parent + counts roll up into one SQL execution.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Pagination composes through to the scalar aggregate scope: a
  // `limit(N)` / `offset(M)` on a count() refine shapes the row set the
  // aggregate sees, so `where(W).limit(N).count()` returns at most N.
  // The correlated builder wraps the source in a derived SELECT that
  // materialises the paginated rows and aggregates over that, in a
  // single SQL execution.
  it(
    'pagination composes through to scalar aggregate scope',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 100 },
          { id: 11, title: 'B', userId: 1, views: 200 },
          { id: 12, title: 'C', userId: 1, views: 300 },
          { id: 13, title: 'D', userId: 1, views: 400 },
          { id: 14, title: 'E', userId: 1, views: 500 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .include('posts', (posts) =>
            posts
              .where((post) => post.views.gte(200))
              .limit(2)
              .count(),
          )
          .all();

        // Four posts match `views >= 200`; `limit(2)` caps the row set
        // the aggregate sees — the count is over the paginated page,
        // not the unpaginated total.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: 2,
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // `distinct(cols).orderBy(c).limit(N).sum(...)` must aggregate the
  // ordered top-N deduped rows. The ROW_NUMBER dedup wrap strips
  // ordering from its output; without reapplying orderBy on the wrap
  // result, LIMIT slices an implementation-defined subset and SUM /
  // AVG / MIN / MAX over that subset gives an arbitrary value. The
  // seed below is designed so the ordered-top-N sum (700) is distinct
  // from any plausible default-order slice.
  it(
    'distinct(cols).orderBy().limit().sum() aggregates the ordered top-N deduped rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        // Two pairs of posts share a title; dedup by title picks the
        // higher-views representative from each pair. The post with
        // unique title C contributes itself.
        //   - title A: max-views representative = (id 11, views 200)
        //   - title B: max-views representative = (id 13, views 300)
        //   - title C: (id 14, views 400)
        // Deduped set (3 rows): views = [200, 300, 400]
        // orderBy(views.desc()).limit(2)         => [400, 300]
        // sum('views')                          => 700
        await seedPosts(runtime, [
          { id: 10, title: 'A', userId: 1, views: 100 },
          { id: 11, title: 'A', userId: 1, views: 200 },
          { id: 12, title: 'B', userId: 1, views: 50 },
          { id: 13, title: 'B', userId: 1, views: 300 },
          { id: 14, title: 'C', userId: 1, views: 400 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .include('posts', (posts) =>
            posts
              .distinct('title')
              .orderBy((post) => post.views.desc())
              .limit(2)
              .sum('views'),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: 700,
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar sum() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField: NumericPostField = 'views';
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) => posts.sum(numericField))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: 300,
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: 300,
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: null,
            address: null,
            posts: null,
          },
        ]);
        // Same single-execution roll-up as count(): scalar sum/avg/
        // min/max emit through the same lateral path.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports scalar avg(), min(), and max() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const numericField: NumericPostField = 'views';
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              avgViews: posts.avg(numericField),
              minViews: posts.min(numericField),
              maxViews: posts.max(numericField),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: { avgViews: 150, minViews: 100, maxViews: 200 },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: { avgViews: 300, minViews: 300, maxViews: 300 },
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: null,
            address: null,
            posts: { avgViews: null, minViews: null, maxViews: null },
          },
        ]);
        // All three scalar branches now pack into a single correlated
        // subquery (json_build_object packing three sub-envelopes); the
        // parent SELECT rolls up everything into one round-trip.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Worked example: the Pothos `totalCount` shape — a paginated row
  // branch alongside a count() scalar branch. This is the headline case
  // that motivated single-query combine emission: one correlated
  // subquery packs both branches; the parent + count + page roll up to
  // one SQL execution per query.
  it(
    'include().combine({ recent: limit(N), count: count() }) resolves in a single execution',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
          { id: 12, title: 'Post C', userId: 1, views: 300 },
          { id: 13, title: 'Post D', userId: 1, views: 400 },
          { id: 14, title: 'Post E', userId: 2, views: 500 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              recent: posts.orderBy((post) => post.id.desc()).limit(3),
              total: posts.count(),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: {
              recent: [
                { id: 13, title: 'Post D', userId: 1, views: 400, embedding: null },
                { id: 12, title: 'Post C', userId: 1, views: 300, embedding: null },
                { id: 11, title: 'Post B', userId: 1, views: 200, embedding: null },
              ],
              // The `limit(3)` paginates the `recent` row branch but
              // does NOT enter the scalar count's scope — Alice has 4
              // posts total, not 3.
              total: 4,
            },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: {
              recent: [{ id: 14, title: 'Post E', userId: 2, views: 500, embedding: null }],
              total: 1,
            },
          },
        ]);
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() combine() evaluates branches independently',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 250 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.combine({
              popular: posts.where((post) => post.views.gte(200)).orderBy((post) => post.id.asc()),
              latestOne: posts.orderBy((post) => post.id.desc()).limit(1),
              totalCount: posts.count(),
            }),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: {
              popular: [{ id: 11, title: 'Post B', userId: 1, views: 250, embedding: null }],
              latestOne: [{ id: 11, title: 'Post B', userId: 1, views: 250, embedding: null }],
              totalCount: 2,
            },
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: {
              popular: [{ id: 12, title: 'Post C', userId: 2, views: 300, embedding: null }],
              latestOne: [{ id: 12, title: 'Post C', userId: 2, views: 300, embedding: null }],
              totalCount: 1,
            },
          },
        ]);
        // Three branches (two row + one scalar) pack into one correlated subquery.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a lateral-capable contract still lowers an include to a correlated subquery',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        // The `lateral` capability flag is inert for include codegen:
        // every include lowers to a correlated subquery regardless.
        const users = createUsersCollectionWithCapabilities(runtime, {
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
        expect(sql).toContain('"invitedUsers__child"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'single-query include uses correlated strategy when only jsonAgg is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          // jsonAgg without lateral → correlated subquery strategy.
          sql: { jsonAgg: true },
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
          sql: { jsonAgg: true },
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
        expect(sql).toContain('"invitedUsers__child"."invited_by_id" = "users"."id"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() supports nested 2-level includes (users -> posts -> comments)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

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
        // Depth-2 on the default postgres test contract must collapse to
        // a single SQL execution via nested correlated subqueries.
        expect(runtime.executions).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'depth-2 include uses correlated subqueries when only jsonAgg is enabled',
    async () => {
      // jsonAgg without lateral. Same acceptance criterion as the case
      // above: one round-trip, regardless of depth or row count, when
      // the target advertises the capability.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithCapabilities(runtime, {
          sql: { jsonAgg: true },
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
