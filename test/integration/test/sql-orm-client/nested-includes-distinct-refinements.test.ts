// Integration coverage for `distinct()` on a non-leaf include combined
// with refinements (`orderBy` / `limit` / `where` / multi-column `distinct`)
// and edge cases (empty grandchildren, zero surviving distinct rows).
//
// `.distinct(cols)` keeps one representative row per `(cols)` group; the
// representative is picked by the caller's `.orderBy(...)`. Grandchildren
// attach only to the surviving representative.
//
// Split from `nested-includes-distinct.test.ts` for the reason documented
// in `./nested-includes-helpers.ts` (per-file test-count threshold of the
// prisma/dev PGlite infrastructure).

import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import { collectionWithCapabilities, LATERAL_CAPABILITIES } from './nested-includes-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested-includes/distinct/refinements', () => {
  // ===========================================================================
  // Refinements at the distinct level (orderBy / limit / where / multi-column
  // distinct) must compose correctly with the dedup lowering. Each refinement
  // applies inside the dedup wrapper before grandchildren attach.
  // ===========================================================================

  describe('distinct composes with refinements at the distinct level', () => {
    it(
      'distinct + orderBy + limit applies after dedup',
      async () => {
        // `.distinct('title')` collapses to one row per title — 'A' wins at
        // id=10, 'B' at id=12, 'C' at id=13 under orderBy [title.asc, id.asc].
        // `limit(2)` then keeps the first two distinct representatives in
        // title-order: 'A' (id=10) and 'B' (id=12). Grandchildren attach
        // only to the survivors.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
            { id: 13, title: 'C', userId: 1, views: 4 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1', postId: 10 },
            { id: 101, body: 'a2', postId: 11 },
            { id: 102, body: 'b1', postId: 12 },
            { id: 103, body: 'c1', postId: 13 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .limit(2)
                .include('comments', (c) => c.select('body').orderBy((cc) => cc.id.asc())),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { id: 10, title: 'A', comments: [{ body: 'a1' }] },
                { id: 12, title: 'B', comments: [{ body: 'b1' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct + where() filters before deduping; grandchildren only attach to surviving rows',
      async () => {
        // `where(views >= 50)` filters out post id=10; the surviving rows
        // are (11, 'High') and (12, 'High'). `.distinct('title')` then
        // collapses them to one representative — id=11 wins under
        // [title.asc, id.asc].
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'Low', userId: 1, views: 10 },
            { id: 11, title: 'High', userId: 1, views: 100 },
            { id: 12, title: 'High', userId: 1, views: 200 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'on low', postId: 10 },
            { id: 101, body: 'on high', postId: 11 },
            { id: 102, body: 'on high2', postId: 12 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('id', 'title')
                .where((p) => p.views.gte(50))
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('body')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [{ id: 11, title: 'High', comments: [{ body: 'on high' }] }],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct over multiple columns yields one row per unique tuple',
      async () => {
        // `.distinct('title', 'views')` partitions by both columns. Posts
        // id=10 and id=11 share (title='A', views=1) so id=10 wins that
        // partition under [title.asc, views.asc, id.asc]; id=11 is
        // dropped. The remaining tuples are all unique so their rows
        // survive untouched.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 1 },
            { id: 12, title: 'A', userId: 1, views: 2 },
            { id: 13, title: 'B', userId: 1, views: 1 },
            { id: 14, title: 'B', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [
            { id: 100, body: 'a1.v1', postId: 10 },
            { id: 101, body: 'a1.v1.dup', postId: 11 },
            { id: 102, body: 'a1.v2', postId: 12 },
            { id: 103, body: 'b1.v1', postId: 13 },
            { id: 104, body: 'b1.v2', postId: 14 },
          ]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('id', 'title', 'views')
                .distinct('title', 'views')
                .orderBy([(p) => p.title.asc(), (p) => p.views.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('body')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { id: 10, title: 'A', views: 1, comments: [{ body: 'a1.v1' }] },
                { id: 12, title: 'A', views: 2, comments: [{ body: 'a1.v2' }] },
                { id: 13, title: 'B', views: 1, comments: [{ body: 'b1.v1' }] },
                { id: 14, title: 'B', views: 2, comments: [{ body: 'b1.v2' }] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Edge cases at the leaves: zero grandchildren on a surviving distinct
  // row, and zero surviving distinct rows after where()-filtering.
  // ===========================================================================

  describe('edge cases', () => {
    it(
      'distinct level with no grandchildren produces an empty array per surviving row',
      async () => {
        // Two posts share the title 'A' so `.distinct('title')` collapses
        // them to one representative (id=10 by orderBy); the surviving 'A'
        // and 'B' rows have no comments, so each `comments` array is empty.
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
            { id: 12, title: 'B', userId: 1, views: 3 },
          ]);
          // No comments seeded.

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .distinct('title')
                .orderBy([(p) => p.title.asc(), (p) => p.id.asc()])
                .include('comments', (c) => c.select('body')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([
            {
              name: 'Alice',
              posts: [
                { title: 'A', comments: [] },
                { title: 'B', comments: [] },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'distinct level filtered to zero rows produces an empty distinct array',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          // Two posts share the title 'A', but `where(views >= 1000)`
          // removes both before dedup runs.
          await seedPosts(runtime, [
            { id: 10, title: 'A', userId: 1, views: 1 },
            { id: 11, title: 'A', userId: 1, views: 2 },
          ]);
          await seedComments(runtime, [{ id: 100, body: 'a1', postId: 10 }]);

          const users = collectionWithCapabilities(runtime, 'User', LATERAL_CAPABILITIES);
          runtime.resetExecutions();

          // `where` filters out every post — `posts` should be `[]`, not
          // emit a stray empty distinct object.
          const rows = await users
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .where((p) => p.views.gte(1_000))
                .distinct('title')
                .include('comments', (c) => c.select('body')),
            )
            .all();

          expect(runtime.executions).toHaveLength(1);
          expect(rows).toEqual([{ name: 'Alice', posts: [] }]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
