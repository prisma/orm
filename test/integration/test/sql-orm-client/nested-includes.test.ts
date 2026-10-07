// Integration coverage for nested includes (depth >= 2) on the default
// lateral path. Every test uses `createUsersCollection(runtime)`, whose
// contract advertises the lateral capability with no override, so the
// dispatch picks the lateral builder. The corpus exists to (a) lock in
// row-shape correctness for the relationship traversal patterns we ship
// and (b) pin the SQL-execution count so a future regression flipping the
// dispatch gate is caught at the contract level, not by downstream
// benchmark drift. Cross-strategy equivalence (lateral vs correlated over
// the same data) lives in `nested-includes-strategy.test.ts`.
//
// Test data shape (kept small and disjoint between tests so failures point
// at one relation traversal at a time):
//
//   User(id, name, email, invitedById?)
//     posts: hasMany Post (by userId)
//     profile: hasOne Profile (by userId)
//     invitedUsers: hasMany User (by invitedById, self-relation)
//     invitedBy: belongsTo User (from invitedById, self-relation)
//
//   Post(id, title, userId, views)
//     author: belongsTo User (from userId)
//     comments: hasMany Comment (by postId)
//
//   Profile(id, userId, bio)
//     user: belongsTo User (from userId)
//
//   Comment(id, body, postId)

import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedComments, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

describe('integration/nested-includes', () => {
  // ===========================================================================
  // Depth-2 traversal: row-shape correctness on the default lateral contract.
  // These tests document the relationship-traversal shapes we ship, resolved
  // through the single-query lateral path.
  // ===========================================================================

  describe('depth-2 traversal shapes', () => {
    it(
      'users -> posts -> comments (hasMany -> hasMany)',
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
            { id: 100, body: 'Comment A1', postId: 10 },
            { id: 101, body: 'Comment A2', postId: 10 },
            { id: 102, body: 'Comment B1', postId: 11 },
          ]);

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
                    { id: 100, body: 'Comment A1', postId: 10 },
                    { id: 101, body: 'Comment A2', postId: 10 },
                  ],
                },
                {
                  id: 11,
                  title: 'Post B',
                  userId: 1,
                  views: 200,
                  embedding: null,
                  comments: [{ id: 102, body: 'Comment B1', postId: 11 }],
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
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> posts -> author (hasMany -> belongsTo back to User)',
      async () => {
        // The to-one leg at depth 2 collapses to a single object (or null
        // when the FK is unsatisfied). This shape is the read path Pothos
        // hits when resolving `{ users { posts { author { name } } } }`.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'A2', userId: 1, views: 2 },
            { id: 12, title: 'B1', userId: 2, views: 3 },
            // Orphan post: FK unsatisfiable. The `author` leg must
            // resolve to `null`, not an error.
            { id: 13, title: 'Orphan', userId: null, views: 4 },
          ]);

          const rows = await users
            .orderBy((user) => user.id.asc())
            .include('posts', (posts) => posts.orderBy((post) => post.id.asc()).include('author'))
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
                  title: 'A1',
                  userId: 1,
                  views: 1,
                  embedding: null,
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                  },
                },
                {
                  id: 11,
                  title: 'A2',
                  userId: 1,
                  views: 2,
                  embedding: null,
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                  },
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
                  author: {
                    id: 2,
                    name: 'Bob',
                    email: 'bob@example.com',
                    invitedById: null,
                    address: null,
                  },
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> profile -> user (hasOne -> belongsTo back-ref)',
      async () => {
        // Two to-one legs chained. Tests that the recursive child decode
        // handles the inner `coerceSingleQueryIncludeResult` correctly:
        // each child JSON array is coerced to its first element under
        // to-one cardinality, including at depth 2.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Alice bio' }]);

          const rows = await users
            .orderBy((user) => user.id.asc())
            .include('profile', (profile) => profile.include('user'))
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
              profile: {
                id: 100,
                userId: 1,
                bio: 'Alice bio',
                user: {
                  id: 1,
                  name: 'Alice',
                  email: 'alice@example.com',
                  invitedById: null,
                  address: null,
                },
              },
            },
            {
              id: 2,
              name: 'Bob',
              email: 'bob@example.com',
              invitedById: null,
              address: null,
              // Profile is null for Bob → no nested user decode.
              profile: null,
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> invitedUsers -> invitedUsers (self-relation chained)',
      async () => {
        // Self-relation at depth 2. The existing depth-1 self-relation
        // tests verify that the child table gets its own reference
        // (`users_2`) instead of the parent's table name. At depth 2 the
        // inner child must get another one (`users_3`).
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
            { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
            { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
            { id: 5, name: 'Eve', email: 'eve@example.com', invitedById: 2 },
          ]);

          const rows = await users
            .where((user) => user.id.eq(1))
            .include('invitedUsers', (invitedUsers) =>
              invitedUsers
                .orderBy((u) => u.id.asc())
                .include('invitedUsers', (deeper) => deeper.orderBy((u) => u.id.asc())),
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
                {
                  id: 2,
                  name: 'Bob',
                  email: 'bob@example.com',
                  invitedById: 1,
                  address: null,
                  invitedUsers: [
                    {
                      id: 4,
                      name: 'Dan',
                      email: 'dan@example.com',
                      invitedById: 2,
                      address: null,
                    },
                    {
                      id: 5,
                      name: 'Eve',
                      email: 'eve@example.com',
                      invitedById: 2,
                      address: null,
                    },
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
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> invitedBy -> invitedBy (belongsTo self-relation chained)',
      async () => {
        // Inverse of the previous case: two `belongsTo` legs walking up
        // the invitation tree. Nullable at every step.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
            { id: 3, name: 'Grandchild', email: 'gc@example.com', invitedById: 2 },
          ]);

          const rows = await users
            .orderBy((user) => user.id.asc())
            .include('invitedBy', (inviter) => inviter.include('invitedBy'))
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              email: 'root@example.com',
              invitedById: null,
              address: null,
              invitedBy: null,
            },
            {
              id: 2,
              name: 'Child',
              email: 'child@example.com',
              invitedById: 1,
              address: null,
              invitedBy: {
                id: 1,
                name: 'Root',
                email: 'root@example.com',
                invitedById: null,
                address: null,
                invitedBy: null,
              },
            },
            {
              id: 3,
              name: 'Grandchild',
              email: 'gc@example.com',
              invitedById: 2,
              address: null,
              invitedBy: {
                id: 2,
                name: 'Child',
                email: 'child@example.com',
                invitedById: 1,
                address: null,
                invitedBy: {
                  id: 1,
                  name: 'Root',
                  email: 'root@example.com',
                  invitedById: null,
                  address: null,
                },
              },
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> invitedUsers -> posts (self-relation then onward)',
      async () => {
        // Crosses a self-relation to a regular hasMany. Inner SELECT
        // operates against a different table from the depth-1 alias.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
            { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'Bob post', userId: 2, views: 1 },
            { id: 11, title: 'Cara post 1', userId: 3, views: 2 },
            { id: 12, title: 'Cara post 2', userId: 3, views: 3 },
          ]);

          const rows = await users
            .where((user) => user.id.eq(1))
            .include('invitedUsers', (inv) =>
              inv
                .orderBy((u) => u.id.asc())
                .include('posts', (p) => p.orderBy((post) => post.id.asc())),
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
                {
                  id: 2,
                  name: 'Bob',
                  email: 'bob@example.com',
                  invitedById: 1,
                  address: null,
                  posts: [
                    {
                      id: 10,
                      title: 'Bob post',
                      userId: 2,
                      views: 1,
                      embedding: null,
                    },
                  ],
                },
                {
                  id: 3,
                  name: 'Cara',
                  email: 'cara@example.com',
                  invitedById: 1,
                  address: null,
                  posts: [
                    {
                      id: 11,
                      title: 'Cara post 1',
                      userId: 3,
                      views: 2,
                      embedding: null,
                    },
                    {
                      id: 12,
                      title: 'Cara post 2',
                      userId: 3,
                      views: 3,
                      embedding: null,
                    },
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
      'sibling depth-2 includes at root (posts(comments) + profile)',
      async () => {
        // Two top-level includes, one with depth-2 nesting and one to-one
        // leaf. The lateral builder produces two top-level join artifacts
        // independently of each other; their depth-2 vs depth-1 nesting
        // shapes must not interfere.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 1 }]);
          await seedComments(runtime, [{ id: 100, body: 'hi', postId: 10 }]);
          await seedProfiles(runtime, [{ id: 1, userId: 1, bio: 'Alice bio' }]);

          const rows = await users
            .include('posts', (posts) => posts.include('comments'))
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
                {
                  id: 10,
                  title: 'Post A',
                  userId: 1,
                  views: 1,
                  embedding: null,
                  comments: [{ id: 100, body: 'hi', postId: 10 }],
                },
              ],
              profile: { id: 1, userId: 1, bio: 'Alice bio' },
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'two depth-2 includes nested under the same parent (posts(comments) + posts(author))',
      async () => {
        // The child SELECT for `posts` must carry *both* depth-2
        // aggregates simultaneously: `comments` (hasMany) and `author`
        // (belongsTo). Each adds its own LATERAL JOIN inside the posts
        // SELECT and its own entry in the inner json_object expression.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 1 }]);
          await seedComments(runtime, [
            { id: 100, body: 'first', postId: 10 },
            { id: 101, body: 'second', postId: 10 },
          ]);

          const rows = await users
            .include('posts', (posts) =>
              posts
                .include('comments', (comments) => comments.orderBy((c) => c.id.asc()))
                .include('author'),
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
                  views: 1,
                  embedding: null,
                  comments: [
                    { id: 100, body: 'first', postId: 10 },
                    { id: 101, body: 'second', postId: 10 },
                  ],
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                  },
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ===========================================================================
  // Depth-3+ traversal: nested aggregation must compose to arbitrary depth.
  // ===========================================================================

  describe('depth-3+ traversal shapes', () => {
    it(
      'users -> posts -> comments + sibling author at depth 2',
      async () => {
        // Same as the previous two-depth-2-includes case, but the data
        // exercises both branches with non-trivial cardinality so a
        // regression that drops one branch's projection is observable.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
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
            { id: 100, body: 'A1.c', postId: 10 },
            { id: 101, body: 'A2.c1', postId: 11 },
            { id: 102, body: 'A2.c2', postId: 11 },
          ]);

          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('comments', (c) => c.orderBy((cc) => cc.id.asc()))
                .include('author'),
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
                  title: 'A1',
                  userId: 1,
                  views: 1,
                  embedding: null,
                  comments: [{ id: 100, body: 'A1.c', postId: 10 }],
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                  },
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
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                  },
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
                  author: {
                    id: 2,
                    name: 'Bob',
                    email: 'bob@example.com',
                    invitedById: null,
                    address: null,
                  },
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> posts -> author -> profile (3 levels, mixed cardinalities)',
      async () => {
        // Three-level chain: hasMany → belongsTo → hasOne. The innermost
        // aggregate runs against `profile` correlated to the depth-2
        // `users` alias.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'A1', userId: 1, views: 1 },
            { id: 11, title: 'B1', userId: 2, views: 2 },
          ]);
          await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Alice bio' }]);

          const rows = await users
            .orderBy((u) => u.id.asc())
            .include('posts', (posts) =>
              posts
                .orderBy((p) => p.id.asc())
                .include('author', (author) => author.include('profile')),
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
                  title: 'A1',
                  userId: 1,
                  views: 1,
                  embedding: null,
                  author: {
                    id: 1,
                    name: 'Alice',
                    email: 'alice@example.com',
                    invitedById: null,
                    address: null,
                    profile: { id: 100, userId: 1, bio: 'Alice bio' },
                  },
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
                  title: 'B1',
                  userId: 2,
                  views: 2,
                  embedding: null,
                  author: {
                    id: 2,
                    name: 'Bob',
                    email: 'bob@example.com',
                    invitedById: null,
                    address: null,
                    profile: null,
                  },
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'users -> invitedUsers -> posts -> comments (4 levels with self-relation)',
      async () => {
        // Maximum depth in the corpus. Crosses a self-relation and then
        // walks the regular blog graph for two more hops.
        await withCollectionRuntime(async (runtime) => {
          const users = createUsersCollection(runtime);
          await seedUsers(runtime, [
            { id: 1, name: 'Root', email: 'root@example.com' },
            { id: 2, name: 'Child', email: 'child@example.com', invitedById: 1 },
          ]);
          await seedPosts(runtime, [{ id: 10, title: 'ChildPost', userId: 2, views: 1 }]);
          await seedComments(runtime, [
            { id: 100, body: 'cm1', postId: 10 },
            { id: 101, body: 'cm2', postId: 10 },
          ]);

          const rows = await users
            .where((u) => u.id.eq(1))
            .include('invitedUsers', (inv) =>
              inv
                .orderBy((u) => u.id.asc())
                .include('posts', (posts) =>
                  posts
                    .orderBy((p) => p.id.asc())
                    .include('comments', (c) => c.orderBy((cc) => cc.id.asc())),
                ),
            )
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              name: 'Root',
              email: 'root@example.com',
              invitedById: null,
              address: null,
              invitedUsers: [
                {
                  id: 2,
                  name: 'Child',
                  email: 'child@example.com',
                  invitedById: 1,
                  address: null,
                  posts: [
                    {
                      id: 10,
                      title: 'ChildPost',
                      userId: 2,
                      views: 1,
                      embedding: null,
                      comments: [
                        { id: 100, body: 'cm1', postId: 10 },
                        { id: 101, body: 'cm2', postId: 10 },
                      ],
                    },
                  ],
                },
              ],
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
