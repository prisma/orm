import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedComments, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

// End-to-end coverage for mutation include read-back across every
// write that can carry `.include()`: create / createAll / update /
// updateAll / upsert (both branches) / delete / deleteAll.
//
// Two deliberate conventions keep these assertions a stable safety net
// for the read-back consolidation:
//   1. Every level uses an explicit `.select(...)` projection, so adding
//      a field to a model never silently changes an expected shape.
//   2. Assertions are always whole-object / whole-array (`toEqual`), so a
//      read-back identity column leaking into the public payload, a
//      mis-keyed relation, or a dropped field all fail loudly.
//
// Bulk results (createAll / updateAll / deleteAll) are sorted on a
// selected scalar before asserting: the SQL layer does not promise a
// row order for a set-returning mutation, only that each row carries its
// own relations.

describe('integration/mutation-include-readback', () => {
  describe('create()', () => {
    it(
      'returns the inserted row with its to-many relation, selected fields only',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          // No FK on posts.user_id, so the relation can be seeded ahead
          // of the parent it points at.
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 9, views: 100 },
            { id: 11, title: 'Post B', userId: 9, views: 200 },
          ]);

          const created = await users
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .create({ id: 9, name: 'Neo', email: 'neo@example.com', invitedById: null });

          expect(created).toEqual({
            name: 'Neo',
            posts: [{ title: 'Post A' }, { title: 'Post B' }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'resolves a to-many relation to an empty array when the inserted row owns none',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          const created = await users
            .select('name')
            .include('posts', (posts) => posts.select('title'))
            .create({ id: 9, name: 'Neo', email: 'neo@example.com', invitedById: null });

          expect(created).toEqual({ name: 'Neo', posts: [] });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns a populated to-one relation, selected fields only',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

          const created = await users
            .select('name')
            .include('invitedBy', (inviter) => inviter.select('name'))
            .create({ id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 });

          expect(created).toEqual({ name: 'Bob', invitedBy: { name: 'Alice' } });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'resolves a to-one relation to null when the foreign key is null',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          const created = await users
            .select('name')
            .include('invitedBy', (inviter) => inviter.select('name'))
            .create({ id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null });

          expect(created).toEqual({ name: 'Bob', invitedBy: null });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('createAll()', () => {
    it(
      'keys each inserted row to its own relations',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedPosts(runtime, [
            { id: 10, title: 'Alice A', userId: 1, views: 100 },
            { id: 11, title: 'Bob A', userId: 2, views: 200 },
            { id: 12, title: 'Bob B', userId: 2, views: 300 },
          ]);

          const created = await users
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .createAll([
              { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
            ]);

          const sorted = [...created].sort((a, b) => a.name.localeCompare(b.name));
          expect(sorted).toEqual([
            { name: 'Alice', posts: [{ title: 'Alice A' }] },
            { name: 'Bob', posts: [{ title: 'Bob A' }, { title: 'Bob B' }] },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('update()', () => {
    it(
      'returns the updated row with its to-many relation, selected fields only',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 1, views: 200 },
          ]);

          const updated = await users
            .where({ id: 1 })
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .update({ name: 'Alice Updated' });

          expect(updated).toEqual({
            name: 'Alice Updated',
            posts: [{ title: 'Post A' }, { title: 'Post B' }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('updateAll()', () => {
    it(
      'keys each updated row to its own relations',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [
            { id: 1, name: 'Draft', email: 'a@example.com' },
            { id: 2, name: 'Draft', email: 'b@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 2, views: 200 },
            { id: 12, title: 'Post C', userId: 2, views: 300 },
          ]);

          const updated = await users
            .where({ name: 'Draft' })
            .select('email')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .updateAll({ name: 'Ready' });

          const sorted = [...updated].sort((a, b) => a.email.localeCompare(b.email));
          expect(sorted).toEqual([
            { email: 'a@example.com', posts: [{ title: 'Post A' }] },
            { email: 'b@example.com', posts: [{ title: 'Post B' }, { title: 'Post C' }] },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('upsert()', () => {
    it(
      'returns the updated row with its relation on the conflict (update) branch',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 100 }]);

          const upserted = await users
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .upsert({
              create: { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
              update: { name: 'Alice Updated' },
            });

          expect(upserted).toEqual({
            name: 'Alice Updated',
            posts: [{ title: 'Post A' }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns the inserted row with its relation on the create branch',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedPosts(runtime, [{ id: 10, title: 'Fresh Post', userId: 5, views: 100 }]);

          const upserted = await users
            .select('name')
            .include('posts', (posts) => posts.select('title'))
            .upsert({
              create: { id: 5, name: 'Carol', email: 'carol@example.com', invitedById: null },
              update: { name: 'Carol Updated' },
            });

          expect(upserted).toEqual({
            name: 'Carol',
            posts: [{ title: 'Fresh Post' }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('delete()', () => {
    it(
      'returns the deleted row with a pre-delete snapshot of its relation, selected fields only',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 1, views: 200 },
          ]);

          const deleted = await users
            .where({ id: 1 })
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .delete();

          expect(deleted).toEqual({
            name: 'Alice',
            posts: [{ title: 'Post A' }, { title: 'Post B' }],
          });

          const remaining = await runtime.query<{ id: number }>('select id from users');
          expect(remaining).toEqual([]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('deleteAll()', () => {
    it(
      'keys each deleted row to its own relation snapshot',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [
            { id: 1, name: 'Remove', email: 'a@example.com' },
            { id: 2, name: 'Remove', email: 'b@example.com' },
            { id: 3, name: 'Keep', email: 'c@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 2, views: 200 },
            { id: 12, title: 'Post C', userId: 2, views: 300 },
          ]);

          const deleted = await users
            .where({ name: 'Remove' })
            .select('email')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .deleteAll();

          const sorted = [...deleted].sort((a, b) => a.email.localeCompare(b.email));
          expect(sorted).toEqual([
            { email: 'a@example.com', posts: [{ title: 'Post A' }] },
            { email: 'b@example.com', posts: [{ title: 'Post B' }, { title: 'Post C' }] },
          ]);

          const remaining = await runtime.query<{ id: number }>('select id from users order by id');
          expect(remaining).toEqual([{ id: 3 }]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('nested and aggregate includes', () => {
    it(
      'update() resolves a depth-2 relation, selected fields at every level',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedPosts(runtime, [{ id: 10, title: 'Post A', userId: 1, views: 100 }]);
          await seedComments(runtime, [
            { id: 100, body: 'First', postId: 10 },
            { id: 101, body: 'Second', postId: 10 },
          ]);

          const updated = await users
            .where({ id: 1 })
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .orderBy((post) => post.id.asc())
                .include('comments', (comments) =>
                  comments.select('body').orderBy((comment) => comment.id.asc()),
                ),
            )
            .update({ name: 'Alice Updated' });

          expect(updated).toEqual({
            name: 'Alice Updated',
            posts: [
              {
                title: 'Post A',
                comments: [{ body: 'First' }, { body: 'Second' }],
              },
            ],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'updateAll() resolves a scalar count() relation per row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [
            { id: 1, name: 'Draft', email: 'a@example.com' },
            { id: 2, name: 'Draft', email: 'b@example.com' },
          ]);
          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 1, views: 200 },
            { id: 12, title: 'Post C', userId: 2, views: 300 },
          ]);

          const updated = await users
            .where({ name: 'Draft' })
            .select('email')
            .include('posts', (posts) => posts.count())
            .updateAll({ name: 'Ready' });

          const sorted = [...updated].sort((a, b) => a.email.localeCompare(b.email));
          expect(sorted).toEqual([
            { email: 'a@example.com', posts: 2 },
            { email: 'b@example.com', posts: 1 },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'createAll() resolves a combine() relation per row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedPosts(runtime, [
            { id: 10, title: 'Post A', userId: 1, views: 100 },
            { id: 11, title: 'Post B', userId: 1, views: 200 },
            { id: 12, title: 'Post C', userId: 1, views: 300 },
          ]);

          const created = await users
            .select('name')
            .include('posts', (posts) =>
              posts.combine({
                recent: posts
                  .select('title')
                  .orderBy((post) => post.id.desc())
                  .limit(2),
                total: posts.count(),
              }),
            )
            .createAll([
              { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null },
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null },
            ]);

          const sorted = [...created].sort((a, b) => a.name.localeCompare(b.name));
          expect(sorted).toEqual([
            {
              name: 'Alice',
              posts: {
                recent: [{ title: 'Post C' }, { title: 'Post B' }],
                total: 3,
              },
            },
            {
              name: 'Bob',
              posts: { recent: [], total: 0 },
            },
          ]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() resolves a populated to-one profile relation, selected fields only',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
          await seedProfiles(runtime, [{ id: 50, userId: 1, bio: 'Hello' }]);

          const updated = await users
            .where({ id: 1 })
            .select('name')
            .include('profile', (profile) => profile.select('bio'))
            .update({ name: 'Alice Updated' });

          expect(updated).toEqual({
            name: 'Alice Updated',
            profile: { bio: 'Hello' },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // Nested mutations write the relations in the same call, then the
  // read-back resolves them. These go through the nested-mutation reload
  // path; assert the same explicit-projection shapes so the read-back is
  // pinned regardless of which mutation path produced the rows.
  describe('nested mutations', () => {
    it(
      'create() with a nested create() resolves the just-written relation',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          const created = await users
            .select('name')
            .include('posts', (posts) => posts.select('title').orderBy((post) => post.id.asc()))
            .create({
              id: 1,
              name: 'Nested',
              email: 'nested@example.com',
              posts: (posts) =>
                posts.create([
                  { id: 10, title: 'First', views: 100 },
                  { id: 11, title: 'Second', views: 200 },
                ]),
            });

          expect(created).toEqual({
            name: 'Nested',
            posts: [{ title: 'First' }, { title: 'Second' }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'update() with a deep nested create() resolves a depth-2 relation',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const users = createReturningUsersCollection(runtime);

          await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

          const updated = await users
            .where({ id: 1 })
            .select('name')
            .include('posts', (posts) =>
              posts
                .select('title')
                .orderBy((post) => post.id.asc())
                .include('comments', (comments) =>
                  comments.select('body').orderBy((comment) => comment.id.asc()),
                ),
            )
            .update({
              posts: (posts) =>
                posts.create([
                  {
                    id: 30,
                    title: 'Deep Post',
                    views: 300,
                    comments: (comments) => comments.create([{ id: 40, body: 'Deep Comment' }]),
                  },
                ]),
            });

          expect(updated).toEqual({
            name: 'Alice',
            posts: [{ title: 'Deep Post', comments: [{ body: 'Deep Comment' }] }],
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
