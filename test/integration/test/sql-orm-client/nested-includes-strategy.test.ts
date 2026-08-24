// Integration coverage for nested includes (depth >= 2) lowered to the
// single correlated-subquery builder.
//
// Split from `nested-includes.test.ts` for the reason documented in
// `./nested-includes-helpers.ts` (per-file test-count threshold of the
// prisma/dev PGlite infrastructure).
//
// These tests pin the SQL-execution count, so a future regression that
// reintroduces a multi-query fallback is caught at the contract level,
// not by downstream benchmark drift. The `lateral`-flag-is-inert guard
// then proves that advertising the lateral capability no longer emits a
// lateral join for an include — every include routes through the
// correlated path regardless of the flag.

import { describe, expect, it } from 'vitest';
import { isSelectAst } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import {
  CORRELATED_CAPABILITIES,
  collectionWithCapabilities,
  LATERAL_CAPABILITIES,
} from './nested-includes-helpers';
import { type PgIntegrationRuntime, seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested-includes/strategy', () => {
  // ===========================================================================
  // Correctness: the correlated builder must yield the canonical result
  // tree. This is the strongest guarantee we offer downstream consumers.
  // ===========================================================================

  describe('correlated result tree', () => {
    async function seedBlog(runtime: PgIntegrationRuntime) {
      await seedUsers(runtime, [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      await seedPosts(runtime, [
        { id: 10, title: 'A1', userId: 1, views: 1 },
        { id: 11, title: 'A2', userId: 1, views: 2 },
        { id: 12, title: 'B1', userId: 2, views: 3 },
      ]);
      await seedComments(runtime, [
        { id: 100, body: 'A1.c1', postId: 10 },
        { id: 101, body: 'A2.c1', postId: 11 },
        { id: 102, body: 'A2.c2', postId: 11 },
      ]);
    }

    const expectedRows = [
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        invitedById: null,
        address: null,
        posts: [
          {
            id: 10,
            title: 'A1',
            userId: 1,
            views: 1,
            embedding: null,
            comments: [{ id: 100, body: 'A1.c1', postId: 10 }],
          },
          {
            id: 11,
            title: 'A2',
            userId: 1,
            views: 2,
            embedding: null,
            comments: [
              { id: 101, body: 'A2.c1', postId: 11 },
              { id: 102, body: 'A2.c2', postId: 11 },
            ],
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
            title: 'B1',
            userId: 2,
            views: 3,
            embedding: null,
            comments: [],
          },
        ],
      },
    ];

    it(
      'depth-2 produces the canonical result tree',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedBlog(runtime);
          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.asc())),
            )
            .all();
          expect(rows).toEqual(expectedRows);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // The `lateral` capability flag is inert for include codegen. A
  // contract advertising `lateral: true` still resolves includes in a
  // single SQL execution, and its compiled plan contains NO lateral join
  // for the include — every include lowers to a correlated subquery.
  // ===========================================================================

  describe('lateral capability flag is inert for include codegen', () => {
    it(
      'a lateral-capable contract resolves a depth-2 include in one execution with no lateral join',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A1', userId: 1, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('posts', (posts) => posts.include('comments')).all();

          expect(runtime.executions).toHaveLength(1);

          const execution = runtime.executions[0];
          const ast = execution?.ast;
          expect(isSelectAst(ast)).toBe(true);
          if (!isSelectAst(ast)) return;
          // No join at all is emitted (a fortiori no lateral join); the
          // include rides on a `SubqueryExpr` projection instead.
          expect(ast.joins ?? []).toEqual([]);
          expect(ast.projection.some((item) => item.alias === 'posts')).toBe(true);
          // The lowered SQL carries no LATERAL keyword either.
          expect(execution?.sql).not.toContain('LATERAL');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // SQL execution counts. Each include tree resolves in a single
  // correlated execution at depth 2, depth 3, and across a self-relation.
  // ===========================================================================

  describe('single SQL execution per include tree', () => {
    it(
      'depth-2 runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'B1', userId: 2, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('posts', (posts) => posts.include('comments')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-3 runs a single SQL execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [{ id: 10, title: 'P', userId: 2, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users
            .include('invitedUsers', (inv) =>
              inv.include('posts', (posts) => posts.include('comments')),
            )
            .all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 self-relation runs a single SQL execution',
      async () => {
        // Self-relation aliasing must propagate through the recursion or
        // the correlated subquery will fail to compile against the same
        // physical table at two depths. Asserting one execution here pins
        // both the alias propagation and the single-query lowering.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
            { id: 3, name: 'Grandchild', email: 'gc@example.com', invitedById: 2 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users.include('invitedUsers', (inv) => inv.include('invitedUsers')).all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Scalar / combine include descriptors resolve in a single correlated
  // SQL execution. The correlated builder lowers scalar and combine at
  // any depth; the dispatch path has no descriptor-aware fallback to
  // multi-query.
  // ===========================================================================

  describe('scalar / combine include descriptors resolve in a single execution', () => {
    it(
      'top-level combine() resolves in a single execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);

          // The correlated builder packs combine() into one subquery
          // whose FROM cross-joins per-branch derived tables and projects
          // json_build_object over them. The whole tree rolls up into a
          // single SQL execution.
          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (p) =>
              p.combine({
                items: p.orderBy((pp) => pp.id.asc()),
                total: p.count(),
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
                items: [
                  { id: 10, title: 'A', userId: 1, views: 1, embedding: null },
                  { id: 11, title: 'B', userId: 1, views: 2, embedding: null },
                ],
                total: 2,
              },
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'nested scalar at depth 2 resolves in a single execution',
      async () => {
        // The correlated builder emits a nested subquery inside the
        // parent row's SELECT so the whole tree resolves in one
        // round-trip. This test pins that recursion: a `count()` at
        // depth 2 must roll up into the same single-query plan as the
        // outer row include.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A', userId: 1, views: 1 }]);
          await seedComments(runtime, [
            { id: 100, body: 'c1', postId: 10 },
            { id: 101, body: 'c2', postId: 10 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) => posts.include('comments', (c) => c.count()))
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [{ id: 10, title: 'A', userId: 1, views: 1, embedding: null, comments: 2 }],
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'scalar count() resolves in a single execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
            { id: 12, title: 'C', userId: 2, views: 3 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) => posts.count())
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: 2,
            },
            {
              id: 2,
              name: 'Bob',
              email: 'bob@example.com',
              invitedById: null,
              address: null,
              posts: 1,
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'pagination composes through to scalar aggregate scope',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 100 },
            { id: 11, title: 'B', userId: 1, views: 200 },
            { id: 12, title: 'C', userId: 1, views: 300 },
            { id: 13, title: 'D', userId: 1, views: 400 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) =>
              posts
                .where((p) => p.views.gte(200))
                .limit(2)
                .count(),
            )
            .all();

          // Three posts match views >= 200; limit(2) caps the row set
          // the aggregate sees — count = 2.
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

    it(
      'distinct(cols).orderBy().limit().sum() aggregates the ordered top-N deduped rows',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 100 },
            { id: 11, title: 'A', userId: 1, views: 200 },
            { id: 12, title: 'B', userId: 1, views: 50 },
            { id: 13, title: 'B', userId: 1, views: 300 },
            { id: 14, title: 'C', userId: 1, views: 400 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
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

          // Deduped reps: views = [200, 300, 400]; ordered top 2 = [400, 300]; sum = 700.
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
      'combine({ rows, count }) resolves in a single execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
            { id: 12, title: 'C', userId: 1, views: 3 },
            { id: 13, title: 'D', userId: 1, views: 4 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          const rows = await users
            .include('posts', (posts) =>
              posts.combine({
                recent: posts.orderBy((p) => p.id.desc()).limit(2),
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
                  { id: 13, title: 'D', userId: 1, views: 4, embedding: null },
                  { id: 12, title: 'C', userId: 1, views: 3, embedding: null },
                ],
                total: 4,
              },
            },
          ]);
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Sentinel coverage for the dispatch boundary: include trees with
  // `distinct()` on a non-leaf level must resolve via the single
  // correlated query. A regression that flips dispatch back to
  // multi-query is caught here at the dispatch boundary, not only
  // downstream in the dedicated distinct suites.
  //
  // Result-shape coverage — hasMany/belongsTo grandchild variants, force-
  // included join keys, depth-3 trees, self-relations, refinements,
  // empty grandchildren — lives in:
  //   - test/integration/nested-includes-distinct.test.ts
  //   - test/integration/nested-includes-distinct-refinements.test.ts
  // ===========================================================================

  describe('non-leaf includes with distinct() resolve in a single SQL execution', () => {
    it(
      'distinct() on a non-leaf include resolves in 1 execution',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'c', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', CORRELATED_CAPABILITIES);
          runtime.resetExecutions();
          await users
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy((p) => p.title.asc())
                .include('comments'),
            )
            .orderBy((u) => u.id.asc())
            .all();
          expect(runtime.executions).toHaveLength(1);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
