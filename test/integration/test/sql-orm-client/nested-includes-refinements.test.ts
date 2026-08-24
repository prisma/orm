// Integration coverage for nested includes (depth >= 2) when the
// nested level carries refinements (`orderBy`, `limit`, `where`,
// `select`) or runs against degenerate data (empty parents, missing
// grandchildren, unsatisfied FKs).
//
// Split from `nested-includes.test.ts` for the reason documented in
// `./nested-includes-helpers.ts` (per-file test-count threshold of the
// prisma/dev PGlite infrastructure).

import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { collectionWithCapabilities } from './nested-includes-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested-includes/refinements', () => {
  // ===========================================================================
  // Refinements at depth 2: orderBy / limit / where / select on the nested
  // level must be honoured by the inner SELECT, not silently dropped by
  // the recursion.
  // ===========================================================================

  describe('depth-2 with refinements', () => {
    it(
      'orderBy + limit on depth-2 child applies inside the nested aggregate',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'P', userId: 1, views: 1 }]);
          await seedComments(runtime, [
            { id: 102, body: 'third', postId: 10 },
            { id: 100, body: 'first', postId: 10 },
            { id: 101, body: 'second', postId: 10 },
          ]);

          const rows = await users
            .include('posts', (posts) =>
              posts.include('comments', (c) => c.orderBy((cc) => cc.id.asc()).limit(2)),
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
                  title: 'P',
                  userId: 1,
                  views: 1,
                  embedding: null,
                  comments: [
                    { id: 100, body: 'first', postId: 10 },
                    { id: 101, body: 'second', postId: 10 },
                  ],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'where() filter on depth-2 child only includes matching rows',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'Low', userId: 1, views: 10 },
            { id: 11, title: 'High', userId: 1, views: 100 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'on low', postId: 10 },
            { id: 101, body: 'on high', postId: 11 },
          ]);

          const rows = await users
            .include('posts', (posts) =>
              posts
                .where((post) => post.views.gte(50))
                .orderBy((p) => p.id.asc())
                .include('comments'),
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
                  id: 11,
                  title: 'High',
                  userId: 1,
                  views: 100,
                  embedding: null,
                  comments: [{ id: 101, body: 'on high', postId: 11 }],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'orderBy on parent and on depth-2 child both apply',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 2, name: 'Bob', email: 'bob@example.com' },
            { id: 1, name: 'Alice', email: 'alice@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 11, title: 'B', userId: 2, views: 1 },
            { id: 10, title: 'A', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 101, body: 'b1', postId: 11 },
            { id: 100, body: 'a1', postId: 10 },
            { id: 102, body: 'b2', postId: 11 },
          ]);

          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.desc())),
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
                  title: 'A',
                  userId: 1,
                  views: 2,
                  embedding: null,
                  comments: [{ id: 100, body: 'a1', postId: 10 }],
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
                  id: 11,
                  title: 'B',
                  userId: 2,
                  views: 1,
                  embedding: null,
                  comments: [
                    { id: 102, body: 'b2', postId: 11 },
                    { id: 101, body: 'b1', postId: 11 },
                  ],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'select() restriction on depth-2 child returns only the selected fields',
      async () => {
        // Field projection in the inner SELECT must propagate from
        // `childState.selectedFields` and the inner json_object expression
        // must mirror it. A regression that hardcodes the full column set
        // would surface here as extra keys on the depth-2 row.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A', userId: 1, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'hi', postId: 10 }]);

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts.select('title').include('comments', (c) => c.select('body')),
            )
            .all();

          expect(rows).toEqual([
            { name: 'Alice', posts: [{ title: 'A', comments: [{ body: 'hi' }] }] },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Edge cases at the leaves: empty, null, mixed.
  // ===========================================================================

  describe('depth-2 edge cases', () => {
    it(
      'parent with no children yields an empty array at depth 1 (no depth-2 fired)',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

          const rows = await users.include('posts', (posts) => posts.include('comments')).all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-1 child present but no depth-2 grandchildren yields empty array',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A', userId: 1, views: 1 }]);
          // No comments seeded.

          const rows = await users.include('posts', (posts) => posts.include('comments')).all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [{ id: 10, title: 'A', userId: 1, views: 1, embedding: null, comments: [] }],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'select() on depth-1 child omitting the grandchild join column still stitches depth-2 results (regression: descendant localColumn force)',
      async () => {
        // Multi-query fallback path: stitching reads
        // `child.raw[grandchildInclude.localColumn]` to bucket children.
        // If `resolveRowsByParent` does not force the grandchild's
        // `localColumn` (Post.id, for the comments include) into the
        // child's `selectedForQuery` when the user's `.select(...)`
        // omits it, the join lookup reads `undefined` and the depth-2
        // arrays come back empty.
        await withCollectionRuntime(async (runtime) => {
          const users = collectionWithCapabilities(runtime, 'User', {});
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'A', userId: 1, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'hi', postId: 10 }]);

          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) => posts.select('title').include('comments'))
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [{ title: 'A', comments: [{ id: 100, body: 'hi', postId: 10 }] }],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'depth-2 to-one with unsatisfied FK yields null (not error)',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'Orphan', userId: null, views: 1 }]);

          // Alice has no posts (userId: null on the post). The depth-2
          // `author` resolution should not run because there are no
          // depth-1 children to recurse into.
          const rows = await users.include('posts', (posts) => posts.include('author')).all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              posts: [],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
